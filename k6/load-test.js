import http from "k6/http"
import { check, sleep } from "k6"

export const options = {
    stages: [
        {duration: "10s", target: 10},
        { duration: "20s", target: 50},
        { duration: "10s", target: 0},
    ],
};

const BASE_URL = "http://localhost:3000";

export default function(){
    const userId = `user_${Math.floor(Math.random()*10)}`;

    const res = http.post(
        `${BASE_URL}/api/check-bucket`,
        JSON.stringify({
            userId: userId,
            limit: 10,
            windowSize: 60
        }),
        {
            headers: {"Content-type": "application/json"}
        }
    );

    check(res, {
        "status is 200 or 429": (r) => r.status === 200 || r.status===429,
        "response has allowed field": (r) => JSON.parse(r.body).allowed !== undefined,
        "response time < 100 ms": (r) => r.timings.duration < 100,
    });

    sleep(0.1);
}