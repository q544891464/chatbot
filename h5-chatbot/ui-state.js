export function setAccessDeniedState(el, state, denied) {
  state.accessDenied = Boolean(denied);
  document.body.classList.toggle("access-denied", state.accessDenied);
  el.input.disabled = state.accessDenied;
  el.sendBtn.disabled = state.accessDenied || Boolean(state.inFlight);
  el.newChatBtn.disabled = state.accessDenied;
  el.chatListBtn.disabled = state.accessDenied;
  el.input.placeholder = state.accessDenied
    ? "未获取到登录用户信息"
    : "询问任何问题";
}

export function setBusyState(el, state, busy, voiceInput) {
  el.sendBtn.disabled = busy || state.accessDenied;
  if (el.voiceBtn) {
    el.voiceBtn.disabled = busy || state.accessDenied || voiceInput.isDisabled() || voiceInput.isTranscribing();
  }
  el.stopBtn.hidden = !busy;
}
