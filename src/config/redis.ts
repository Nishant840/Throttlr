import { createClient } from "redis";
import dotenv from "dotenv"

dotenv.config()

const client = createClient({
    url: process.env.REDIS_URL || "redis://localhost:6379",
    socket: {
        connectTimeout: 5000,
        reconnectStrategy: (retries: number): number | false => {
            if(retries > 3){
                isRedisHealthy = false;
                return false;
            }
            return Math.min(retries*100, 3000);
        }
    }
});

client.on("error", (err)=>{
    isRedisHealthy = false;
    console.error("Redis eror:", err);
});

client.on("connect",()=>{
    console.log("Redis Connected");
});

client.on("reconnecting", ()=>{
    isRedisHealthy = false;
    console.log("Redis reconnecting...");
})

export let isRedisHealthy = true;

client.on("ready", ()=>{
    isRedisHealthy = true;
    console.log("Redis ready");
})

client.on("end", ()=>{
    isRedisHealthy = false;
    console.log("Redis disconnected");
})

export default client;