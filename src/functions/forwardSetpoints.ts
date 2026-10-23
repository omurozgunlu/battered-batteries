import { app, type InvocationContext } from "@azure/functions";
import { BatteredBatteriesClient } from "../clients/batteredBatteries/client";
import { MessageProcessor } from "../services/messageProcessor";
import { createForwardSetpoints } from "../handlers/forwardSetpoints";
import { loadConfig } from "../config";

const config = loadConfig();

const apiClient = new BatteredBatteriesClient({
  apiKey: config.BATTERED_BATTERIES_API_KEY,
  baseURL: config.BATTERED_BATTERIES_API_URL,
});

const processor = new MessageProcessor(apiClient);

export const forwardSetpointsHandler = createForwardSetpoints(processor);

app.serviceBusQueue("forwardSetpoints", {
  connection: "CONNECTION-STRING-SBQ-BATBAT-SPT",
  queueName: "sbq-batbat-spt",
  cardinality: "many",
  handler: forwardSetpointsHandler,
});
