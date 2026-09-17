import http from "node:http";
import express from "express";
import cors from "cors";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { CoOpSurvivalRoom } from "./rooms/co-op-survival.js";

const PORT = Number(process.env.PORT ?? 2567);
// Locked down to an explicit allow-list, not a bare wildcard — this
// server is meant to end up reachable from the internet (see
// homelab-deploy's own guidance on this exact point), not just localhost.
// Adjustable via env without a code change once a real deployed client
// origin exists.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173").split(",");

const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.get("/health", (_req, res) => res.json({ ok: true }));

const httpServer = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("co_op_survival", CoOpSurvivalRoom);

httpServer.listen(PORT, () => {
  console.log(`[server] Colyseus co-op proof-of-concept listening on :${PORT}`);
});
