// mammoth 的浏览器整包（node 入口依赖 fs，不能直接打进界面），类型同 mammoth
declare module 'mammoth/mammoth.browser.min.js' {
  import mammoth from 'mammoth'
  export default mammoth
}
