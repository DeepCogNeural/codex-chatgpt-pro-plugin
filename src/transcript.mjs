export const SENT_HEADING = "Message Sent To ChatGPT Pro";
export const UNSENT_HEADING = "Message Not Sent To ChatGPT Pro";
export const SEND_STATUS_UNKNOWN_HEADING = "Message Send Status Unknown";
export const RECEIVED_HEADING = "Message Received From ChatGPT Pro";
export const THREAD_ECHO_DISABLE_ENV = "CHATGPT_THREAD_ECHO";

function headingForSendStatus({ sendStatus = "", sentToChatGpt = true } = {}) {
  if (sendStatus === "not_sent") return UNSENT_HEADING;
  if (sendStatus === "send_status_unknown") return SEND_STATUS_UNKNOWN_HEADING;
  if (sendStatus === "sent_verified") return SENT_HEADING;
  return sentToChatGpt ? SENT_HEADING : UNSENT_HEADING;
}

export function renderChatGptTranscript({
  sentMarkdown,
  receivedMarkdown = "",
  sentToChatGpt = true,
  sendStatus = "",
}) {
  return renderLiveExchange({ sentMarkdown, receivedMarkdown, sentToChatGpt, sendStatus });
}

export function renderLiveExchange({ sentMarkdown, receivedMarkdown, sentToChatGpt = true, sendStatus = "" }) {
  return [
    `## ${headingForSendStatus({ sendStatus, sentToChatGpt })}`,
    "",
    String(sentMarkdown || "").trim(),
    "",
    `## ${RECEIVED_HEADING}`,
    "",
    String(receivedMarkdown || "").trim() || "_No assistant message captured._",
    "",
  ].join("\n");
}

export function renderReceivedEcho({ receivedMarkdown }) {
  return [
    `## ${RECEIVED_HEADING}`,
    "",
    String(receivedMarkdown || "").trim() || "_No assistant message captured._",
    "",
  ].join("\n");
}

export function shouldPrintThreadEcho(env = process.env) {
  return !["0", "false", "no", "off"].includes(String(env[THREAD_ECHO_DISABLE_ENV] || "").toLowerCase());
}
