import express from "express"
import client from "./config/redis";
import rateLimiterRouter from "./routes/rateLimiter"

const app = express();

app.use(express.json());

// Connect redis
client.connect();

app.get("/health",(req,res)=>{
    res.json({
        status:"ok"
    });
});

app.use("/api",rateLimiterRouter);

export default app;