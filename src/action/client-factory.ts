import { createSeqeraClient } from "../api/client.js";

export function actionSeqeraClientFactory(config: { baseUrl: string; accessToken: string }) {
  return createSeqeraClient({
    ...config,
    userAgent: "seqeralabs/action-seqera-launch",
  });
}
