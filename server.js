import wisp from "wisp-server-node"
import { createBareServer } from "@tomphttp/bare-server-node"
import { uvPath } from "@titaniumnetwork-dev/ultraviolet"
import { epoxyPath } from "@mercuryworkshop/epoxy-transport"
import { bareModulePath } from "@mercuryworkshop/bare-as-module3"
import { baremuxPath } from "@mercuryworkshop/bare-mux/node"
import express from "express";
import compression from "compression";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import cluster from "node:cluster";
import { availableParallelism } from "node:os";
import process from "node:process";

if (cluster.isPrimary) {
    const numCPUs = availableParallelism();
    console.log(`Primary ${process.pid} is running. Forking for ${numCPUs} CPUs...`);

    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }

    cluster.on("exit", (worker, code, signal) => {
        console.log(`worker ${worker.process.pid} died. Restarting...`);
        cluster.fork();
    });
} else {
    const bare = createBareServer("/bare/")
    const __dirname = join(fileURLToPath(import.meta.url), "..");
    const app = express();
    const publicPath = "public"; // if you renamed your directory to something else other than public

    // 高速化：圧縮とキャッシュの適用
    app.use(compression());

    const cacheOptions = {
        maxAge: '1d',
        immutable: true
    };

    app.use(express.static(publicPath, cacheOptions));
    app.use("/uv/", express.static(uvPath, cacheOptions));
    app.use("/epoxy/", express.static(epoxyPath, cacheOptions));
    app.use("/baremux/", express.static(baremuxPath, cacheOptions));
    app.use("/baremod/", express.static(bareModulePath, cacheOptions));

    app.use((req, res) => {
        res.status(404);
        res.sendFile(join(__dirname, publicPath, "404.html")); // change to your 404 page
    });

    const server = createServer();

    server.on("request", (req, res) => {
        if (bare.shouldRoute(req)) {
            bare.routeRequest(req, res);
        } else {
            app(req, res);
        }
    });

    server.on("upgrade", (req, socket, head) => {
        if (req.url.endsWith("/wisp/")) {
            wisp.routeRequest(req, socket, head);
        } else if (bare.shouldRoute(req)) {
            bare.routeUpgrade(req, socket, head);
        } else {
            socket.end();
        }
    });

    let port = parseInt(process.env.PORT || "");

    if (isNaN(port)) port = 8080; // set your port

    server.on("listening", () => {
        const address = server.address();
        console.log(`Worker ${process.pid} listening on http://localhost:${address.port}`);
    });

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    function shutdown() {
        console.log("SIGTERM signal received: closing HTTP server");
        server.close();
        bare.close();
        process.exit(0);
    }

    server.listen({
        port,
    });
}
