'use strict';

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const sourceRoot = path.resolve(__dirname, 'src');
const liveMode = process.argv[2] === 'live';
const requestedPort = liveMode ? 443 : Number(process.env.PORT || 3000);
const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8'
};

function send(response, status, body, headers) {
    response.writeHead(status, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, headers));
    response.end(body);
}

function handleStaticRequest(request, response) {
    const url = new URL(request.url || '/', 'http://localhost');
    let pathname;
    try {
        pathname = url.pathname === '/' ? '/example.html' : decodeURIComponent(url.pathname);
    } catch (error) {
        send(response, 400, 'Bad request');
        return;
    }
    const filePath = path.resolve(sourceRoot, '.' + pathname);
    const relativePath = path.relative(sourceRoot, filePath);

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        send(response, 403, 'Forbidden');
        return;
    }

    fs.stat(filePath, (statError, stat) => {
        if (statError || !stat.isFile()) {
            send(response, 404, 'Not found');
            return;
        }

        response.writeHead(200, {
            'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
        });
        fs.createReadStream(filePath).pipe(response);
    });
}

const server = liveMode
    ? https.createServer({
        key: fs.readFileSync(path.join(__dirname, 'https-requirements', 'localhost.key')),
        cert: fs.readFileSync(path.join(__dirname, 'https-requirements', 'localhost.crt'))
    }, handleStaticRequest)
    : http.createServer(handleStaticRequest);

server.on('error', error => {
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${requestedPort} is already in use.`);
    } else if (error.code === 'EACCES') {
        console.error(`Permission was denied while binding to port ${requestedPort}.`);
    } else {
        console.error(error);
    }
    process.exitCode = 1;
});

server.listen(requestedPort, '127.0.0.1', () => {
    if (liveMode) {
        console.log('Live adapter running at https://localhost/');
        console.log('It serves /framework.js for the real Genesys Cloud iframe.');
    } else {
        console.log(`Local mock running at http://localhost:${requestedPort}/`);
        console.log('Run "node mock-server.js live" for the opt-in HTTPS live adapter.');
    }
});
