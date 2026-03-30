import { Request, Response, NextFunction } from "express";
import { slidingWindow } from "../algorithms/slidingWindow";
import { isRedisHealthy } from "../config/redis";

interface RateLimitOptions {
    limit?: number;
    windowSize?: number;
    keyGenerator?: (req:Request) => string;
}

export function rateLimitMiddleware(options: RateLimitOptions = {}){
    const {
        limit = 10,
        windowSize = 60,
        keyGenerator = (req:Request)=>{
            const indentifier = req.body?.userId || 
                   req.headers['x-user-id'] as string ||
                   req.ip ||
                   "anonymous";
            return `${indentifier}:${req.path}`;
        }
    } = options;

    return async (req:Request, res:Response, next: NextFunction) => {

        if(!isRedisHealthy){
            console.warn("Redis unavailable - failing open");
            next();
            return;
        }

        const identifier = keyGenerator(req);
        const key = `ratelimit:${identifier}`;

        const result = await slidingWindow(key, limit, windowSize);

        res.set({
            'X-RateLimit-Limit': limit,
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

        next();
    };
}