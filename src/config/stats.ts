import client from "./redis";

export async function incrementStats(
    userId: string,
    allowed: boolean
): Promise<void>{
    const multi = client.multi();

    multi.incr("stats:total");

    if(allowed){
        multi.incr("stats:allowed");
    }
    else{
        multi.incr("stats:blocked");
    }

    multi.incr(`stats:user:${userId}:total`);

    if(allowed){
        multi.incr(`stats:user:${userId}:allowed`);
    }
    else{
        multi.incr(`stats:user:${userId}:blocked`);
    }

    multi.sAdd("stats:users", userId);

    await multi.exec();
}

export async function getStats(){
    const multi = client.multi();

    multi.get("stats:total");
    multi.get("stats:allowed");
    multi.get("stats:blocked");
    multi.sMembers("stats:users");

    const [total, allowed, blocked, users] = await multi.exec() as unknown as [
        string | null,
        string | null,
        string | null,
        string[]
    ];
    
    const userStats = await Promise.all(
        (users || []).map(async (userId)=>{
            const [userTotal, userAllowed, userBlocked] = await Promise.all([
                client.get(`stats:user:${userId}:total`),
                client.get(`stats:user:${userId}:allowed`),
                client.get(`stats:user:${userId}:blocked`)
            ]);

            return {
                userId,
                total: parseInt(userTotal || "0"),
                allowed: parseInt(userAllowed || "0"),
                blocked: parseInt(userBlocked || "0")
            };
        })
    );

    return {
        total: parseInt(total || "0"),
        allowed: parseInt(allowed || "0"),
        blocked: parseInt(blocked || "0"),
        activeUsers: (users || []).length,
        users: userStats
    };
}

export async function resetUserStats(userId: string): Promise<void>{
    const multi = client.multi();

    multi.del(`stats:user:${userId}:total`);
    multi.del(`stats:user:${userId}:allowed`);
    multi.del(`stats:user:${userId}:blocked`);
    multi.sRem("stats:users", userId);

    await multi.exec();
}