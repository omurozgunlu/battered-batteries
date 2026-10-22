import { app, type InvocationContext } from "@azure/functions";
import { BatteredBatteriesClient } from "../clients/batteredBatteries";
import { MessageProcessor } from "../services/messageProcessor";
import { createForwardSetpoints } from "../handlers/forwardSetpoints";

const apiClient = new BatteredBatteriesClient({
  apiKey: process.env.BATTERED_BATTERIES_API_KEY,
});

const processor = new MessageProcessor(apiClient);

export const forwardSetpointsHandler = createForwardSetpoints(processor);

app.serviceBusQueue("forwardSetpoints", {
  connection: "CONNECTION-STRING-SBQ-BATBAT-SPT",
  queueName: "sbq-batbat-spt",
  cardinality: "many",
  handler: forwardSetpointsHandler,
});
