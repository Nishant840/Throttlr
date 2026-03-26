import { createClient } from "redis";
import dotenv from "dotenv"

dotenv.config()

const client = createClient({
    url: process.env.REDIS_URL || "redis://locahost:6379"
});

client.on("error", (err)=>{
    console.error("Redis eror:", err);
});

client.on("connect",()=>{
    console.log("Redis Connected");
});

export default client;