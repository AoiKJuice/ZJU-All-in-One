package top.aoikjuice.zjuallinone;

import java.io.ByteArrayOutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Random;
import java.util.concurrent.ConcurrentHashMap;
import okhttp3.Dns;

/**
 * 校内域名（*.zju.edu.cn）先问学校的 DNS（10.10.0.21 / 10.10.2.21），问不到再用系统 DNS。
 * 校园 5G 专网会把 10.x 的流量送进学校，但手机的系统 DNS 常是运营商或私人 DNS，给的是公网答案：
 * 只在校内解析的站点（本科生院、团委……）解析不到，有公网地址的站点（学工部……）被当作校外拒绝（「仅限校内」403）。
 * 2026-11-08 用户手机上官网栏目大半取不到、图书馆跳转过多，按公网与校内 DNS 的答案对照即是这种情况。
 */
final class CampusDns implements Dns {
    static final CampusDns INSTANCE = new CampusDns();

    private static final String[] SERVERS = {"10.10.0.21", "10.10.2.21"};
    private static final int TIMEOUT_MS = 1200;
    private static final long ANSWER_TTL = 10 * 60_000L;
    /** 校内 DNS 连不上（真在校外）时一分钟内不再试，免得每个请求都多等 */
    private static final long UNREACHABLE_TTL = 60_000L;

    private static final class Entry {
        final List<InetAddress> addresses;
        final long until;

        Entry(List<InetAddress> addresses, long until) {
            this.addresses = addresses;
            this.until = until;
        }
    }

    private final ConcurrentHashMap<String, Entry> cache = new ConcurrentHashMap<>();
    private volatile long unreachableUntil = 0;
    private final Random random = new Random();

    @Override
    public List<InetAddress> lookup(String hostname) throws UnknownHostException {
        String host = hostname.toLowerCase(Locale.ROOT);
        if (host.endsWith(".zju.edu.cn") || host.equals("zju.edu.cn")) {
            List<InetAddress> campus = campus(host);
            if (campus != null && !campus.isEmpty()) return campus;
        }
        return Dns.SYSTEM.lookup(hostname);
    }

    private List<InetAddress> campus(String host) {
        long now = System.currentTimeMillis();
        Entry hit = cache.get(host);
        if (hit != null && hit.until > now) return hit.addresses;
        if (unreachableUntil > now) return null;
        boolean answered = false;
        for (String server : SERVERS) {
            try {
                List<InetAddress> found = query(server, host);
                answered = true;
                if (!found.isEmpty()) {
                    cache.put(host, new Entry(found, now + ANSWER_TTL));
                    return found;
                }
            } catch (Exception ignored) {
                // 这台没回，试下一台
            }
        }
        if (!answered) unreachableUntil = now + UNREACHABLE_TTL;
        return null;
    }

    /** 一次 UDP 查询 A 记录，只取应答区里的 A（CNAME 链上的地址也在应答区） */
    private List<InetAddress> query(String server, String host) throws Exception {
        int id = random.nextInt(0x10000);
        ByteArrayOutputStream q = new ByteArrayOutputStream();
        q.write(id >> 8);
        q.write(id & 0xff);
        q.write(0x01); // RD
        q.write(0x00);
        q.write(0x00);
        q.write(0x01); // QDCOUNT 1
        for (int i = 0; i < 6; i++) q.write(0x00);
        for (String label : host.split("\\.")) {
            byte[] b = label.getBytes("US-ASCII");
            q.write(b.length);
            q.write(b, 0, b.length);
        }
        q.write(0x00);
        q.write(0x00);
        q.write(0x01); // QTYPE A
        q.write(0x00);
        q.write(0x01); // QCLASS IN
        byte[] request = q.toByteArray();

        byte[] buf = new byte[1500];
        try (DatagramSocket socket = new DatagramSocket()) {
            socket.setSoTimeout(TIMEOUT_MS);
            socket.send(new DatagramPacket(request, request.length, new InetSocketAddress(server, 53)));
            DatagramPacket reply = new DatagramPacket(buf, buf.length);
            while (true) {
                socket.receive(reply);
                if (reply.getLength() >= 12 && ((buf[0] & 0xff) << 8 | (buf[1] & 0xff)) == id) break;
            }
            return parse(buf, reply.getLength(), host);
        }
    }

    private static List<InetAddress> parse(byte[] m, int len, String host) throws Exception {
        List<InetAddress> out = new ArrayList<>();
        int rcode = m[3] & 0x0f;
        if (rcode != 0) return out;
        int qd = u16(m, 4);
        int an = u16(m, 6);
        int p = 12;
        for (int i = 0; i < qd; i++) p = skipName(m, p) + 4;
        for (int i = 0; i < an && p + 10 <= len; i++) {
            p = skipName(m, p);
            int type = u16(m, p);
            int rdlen = u16(m, p + 8);
            p += 10;
            if (type == 1 && rdlen == 4 && p + 4 <= len) {
                byte[] ip = {m[p], m[p + 1], m[p + 2], m[p + 3]};
                out.add(InetAddress.getByAddress(host, ip));
            }
            p += rdlen;
        }
        return out;
    }

    private static int u16(byte[] m, int p) {
        return (m[p] & 0xff) << 8 | (m[p + 1] & 0xff);
    }

    private static int skipName(byte[] m, int p) {
        while (true) {
            int b = m[p] & 0xff;
            if (b == 0) return p + 1;
            if ((b & 0xc0) == 0xc0) return p + 2;
            p += b + 1;
        }
    }
}
