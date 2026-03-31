import express from "express"
import client from "./config/redis";
import rateLimiterRouter from "./routes/rateLimiter"
import { rateLimitMiddleware } from "./middleware/rateLimiter";
import path from "path";

const app = express();

app.use(express.json());

app.use("/dashboard", express.static(path.join(process.cwd(), "src/dashboard")));

// Connect redis
client.connect();

app.get("/health",(req,res)=>{
    res.json({
        status:"ok"
    });
});

app.use("/api",rateLimiterRouter);

app.get("/protected", rateLimitMiddleware({limit: 3, windowSize: 30}), (req,res)=>{
    res.json({
        message: "You accessed a protected route!"
    });
});

export default app;