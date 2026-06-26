import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Serve the static ministry website from the workspace root
const siteRoot = path.resolve(process.cwd(), "../..");

// Direct article URL routes (must come before express.static)
app.get("/articles/notforgotten.notoverlooked.", (_req, res) => {
  res.sendFile(path.resolve(siteRoot, "articles/index.html"));
});
app.get("/articles/notforgotten.notoverlooked", (_req, res) => {
  res.sendFile(path.resolve(siteRoot, "articles/notforgotten.notoverlooked/index.html"));
});

app.use(express.static(siteRoot, { extensions: ["html"] }));

export default app;
