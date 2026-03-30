import app from "./app"
import dotenv from "dotenv"

dotenv.config()

const PORT = process.env.PORT || 3000
const INSTANCE_ID = process.env.INSTANCE_ID || "local";

app.listen(PORT, ()=>{
    console.log(`Server is running on port ${PORT} | Instance: ${INSTANCE_ID}`);
})