import express from "express"
import client from "./config/redis";

const app = express();

app.use(express.json());

// Connect redis
client.connect();

app.get("/health",(req,res)=>{
    res.json({
        status:"ok"
    });
});

export default app;