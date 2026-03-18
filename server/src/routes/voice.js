import express from "express";
import { getVoiceXmlMessage } from "../services/voiceNotification.js";

const router = express.Router();

router.get("/", (req, res) => {
  const message = req.query.message || "EMA alert triggered";
  const xml = getVoiceXmlMessage(message);
  res.set("Content-Type", "application/xml");
  return res.status(200).send(xml);
});

export default router;
