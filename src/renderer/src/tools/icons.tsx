// 工具徽标：48×48 细线图标，墨色主体 + 一处主题色。悬停（父级 .tool-card:hover）时的动效写在 styles.css 的「工具页」一节，
// 各部件用 class 标出，新工具照此画：主体静止，一两个部件做小幅、有趣的动作

/** 毕业自审：学位帽，悬停时帽子微微扬起、流苏摆动，旁边划出一个勾 */
export function GraduationIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <g className="ti-cap">
        <path className="ti-ink" d="M24 9 44 18 24 27 4 18Z" />
        <path className="ti-ink" d="M12 22v8.5c0 3 5.4 5.5 12 5.5s12-2.5 12-5.5V22" />
        <g className="ti-tassel">
          <path className="ti-accent" d="M24 18h15v9" />
          <path className="ti-accent ti-fill" d="M37.6 27h2.8l1 5h-4.8Z" />
        </g>
      </g>
      <path className="ti-accent ti-check" d="M4.5 39.5l4.2 4.2L17 35.5" />
    </svg>
  )
}
