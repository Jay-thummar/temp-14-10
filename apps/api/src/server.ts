import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(helmet());
app.use(morgan("dev"));

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change";

// Simple in-memory users store for bootstrap; will be replaced with Mongo
const users: { id: string; email: string; passwordHash: string }[] = [];

// Auth routes (mock)
app.post("/api/auth/register", (req: Request, res: Response) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ message: "email and password required" });
  const id = String(Date.now());
  users.push({ id, email, passwordHash: password });
  const accessToken = jwt.sign({ sub: id, email }, JWT_SECRET, { expiresIn: "15m" });
  const refreshToken = jwt.sign({ sub: id, type: "refresh" }, JWT_SECRET, { expiresIn: "7d" });
  return res.json({ user: { id, email }, accessToken, refreshToken });
});

app.post("/api/auth/login", (req: Request, res: Response) => {
  const { email, password } = req.body || {};
  const u = users.find((x) => x.email === email && x.passwordHash === password);
  if (!u) return res.status(401).json({ message: "invalid credentials" });
  const accessToken = jwt.sign({ sub: u.id, email }, JWT_SECRET, { expiresIn: "15m" });
  const refreshToken = jwt.sign({ sub: u.id, type: "refresh" }, JWT_SECRET, { expiresIn: "7d" });
  return res.json({ user: { id: u.id, email }, accessToken, refreshToken });
});

app.post("/api/auth/refresh", (req: Request, res: Response) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ message: "refreshToken required" });
  try {
    const payload = jwt.verify(refreshToken, JWT_SECRET) as any;
    if (payload.type !== "refresh") throw new Error("invalid token");
    const accessToken = jwt.sign({ sub: payload.sub }, JWT_SECRET, { expiresIn: "15m" });
    return res.json({ accessToken });
  } catch (err) {
    return res.status(401).json({ message: "invalid refresh token" });
  }
});

// Mock search endpoint
app.get("/api/search", (req: Request, res: Response) => {
  const q = String(req.query.q || "");
  const page = Number(req.query.page || 1);
  const results = q
    ? [
        {
          masterId: "mock-iphone-13",
          title: `iPhone 13 - ${q}`,
          thumbnail: "https://via.placeholder.com/128",
          cheapest: { platform: "amazon", price: 59999, url: "https://example.com" },
          platforms: [
            { platform: "amazon", price: 59999, currency: "INR", productUrl: "https://example.com" },
            { platform: "flipkart", price: 58999, currency: "INR", productUrl: "https://example.com" },
          ],
        },
      ]
    : [];
  res.json({ query: q, meta: { total: results.length, page }, results });
});

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ message: "internal error" });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${PORT}`);
});

