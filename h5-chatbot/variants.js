const DEFAULT_VARIANT = {
  id: "default",
  title: "政企AI助手",
  welcomeTitle: "你好！我是政企AI助手",
  logo: "./static/AIlogo.png",
  questionBank: "./question-bank.json",
  agentConfigId: null,
};

const VARIANTS = {
  default: DEFAULT_VARIANT,
  gongye: {
    id: "gongye",
    title: "智改数转诊断助手",
    welcomeTitle: "你好！我是智改数转诊断助手",
    logo: "./static/工业logo.png",
    questionBank: "./question-bank-gongye.json",
    agentConfigId: 6,
  },
  chanshu: {
    id: "chanshu",
    title: "产数AI助手",
    welcomeTitle: "你好！我是产数AI助手",
    logo: "./static/AIlogo.png",
    questionBank: "./question-bank.json",
    agentConfigId: 3,
  },
};

export function getVariant(pathname = window.location.pathname) {
  const firstSegment = String(pathname || "/").split("/").filter(Boolean)[0] || "";
  return VARIANTS[firstSegment] || DEFAULT_VARIANT;
}
