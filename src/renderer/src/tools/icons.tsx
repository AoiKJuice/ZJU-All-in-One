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

/** 选课：一页课表，悬停时主题色的课块跳起落进格子、打上勾，顶上的装订环晃一下 */
export function CourseIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect className="ti-ink" x="5" y="10" width="38" height="32" rx="4" />
      <path className="ti-ink" d="M5 18.5h38" />
      <path className="ti-ink ti-rings" d="M15 6.5v7M33 6.5v7" />
      <rect className="ti-ink" x="10.5" y="23.5" width="9" height="6.5" rx="1.6" />
      <rect className="ti-ink" x="19.5" y="33" width="9" height="5" rx="1.6" />
      <g className="ti-pick">
        <rect className="ti-accent ti-fill" x="27.5" y="23" width="11" height="8" rx="1.8" />
        <path className="ti-tick" d="M30.2 27.1l2.2 2.1 3.9-4" />
      </g>
    </svg>
  )
}

/** 问卷填写：夹板上的问卷，悬停时笔提起回到行首，落笔写出最后一行 */
export function FormIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect className="ti-ink" x="8" y="9" width="26" height="33" rx="3" />
      <rect className="ti-ink" x="15" y="5.5" width="12" height="6" rx="1.8" />
      <path className="ti-ink" d="M14 19h11M14 26h14" />
      <path className="ti-accent ti-write" d="M14 33.5h10" />
      <g className="ti-pen">
        <path className="ti-accent" d="M25.5 33.5l1.6-5.2 12.6-12.6a2.6 2.6 0 0 1 3.7 3.7L30.8 32Z" />
        <path className="ti-accent" d="M37.4 18l3.7 3.7" />
      </g>
    </svg>
  )
}

/** 图书馆预约：摊开的书，右页夹一根主题色书签；悬停时左页微微翻起，书签往下一落、晃一晃 */
export function LibraryIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <g className="ti-page">
        <path className="ti-ink" d="M24 14.5C19.5 11.8 13 11 6.5 11.6v23.6c6.5-.6 13 .2 17.5 2.9" />
        <path className="ti-ink" d="M11 18.6c3.4-.1 6.5.4 9 1.4M11 24.4c3.4-.1 6.5.4 9 1.4" />
      </g>
      <path className="ti-ink" d="M24 14.5c4.5-2.7 11-3.5 17.5-2.9v23.6c-6.5-.6-13 .2-17.5 2.9Z" />
      <path className="ti-ink" d="M28 25.4c2.5-1 5.6-1.5 9-1.4" />
      <path className="ti-accent ti-fill ti-ribbon" d="M31.5 12.4h5v11.4l-2.5-2.1-2.5 2.1Z" />
    </svg>
  )
}
