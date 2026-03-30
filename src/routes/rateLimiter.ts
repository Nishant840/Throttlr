import { Router, Request, Response } from "express";
import { slidingWindow } from "../algorithms/slidingWindow";
import { tokenBucket } from "../algorithms/tokenBucket";

const router = Router();

router.post("/check", async (req: Request,res: Response)=>{
    const {userId, limit=10, windowSize=60} = req.body;

    if(!userId){
        res.status(400).json({
            error: "UserId is required"
        });
        return;
    }

    const key = `ratelimit:${userId}`;

    const result = await slidingWindow(key,limit,windowSize);

    res.set({
        "X-RateLimit-Limit": limit,
        "X-RateLimit-Remaining": result.remaining,
        "X-RateLimit-Reset": result.resetAt
    });

    if(!result.allowed){
        res.status(429).json({
            allowed: false,
            message: "Too many requests",
            retryAfter: Math.ceil((result.resetAt-Date.now()) / 1000)
        });
        return;
    }

    res.json({
        allowed: true,
        remaining: result.remaining,
        resetAt: result.resetAt
    });
});

router.post("/check-bucket",async (req:Request, res:Response) => {
    const {userId, capacity=10, refillRate=2} = req.body;

    if(!userId){
        res.status(400).json({
            error: "UserId is required"
        });
        return;
    }

    const key = `tokenbucket:${userId}`;

    const result = await tokenBucket(key, capacity, refillRate);

    res.set({
        'X-RateLimit-Limit': capacity,
        'X-RateLimit-Remaining': result.remaining,
        'X-RateLimit-Reset': result.resetAt
    });

    if(!result.allowed){
        res.status(429).json({
            allowed: false,
            message: "Too many requests",
            retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000)
        });
        return;
    }

    res.json({
        allowed: true,
        remaining: result.remaining,
        resetAt: result.resetAt
    });
})
export default router;