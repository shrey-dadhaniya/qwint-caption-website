### Logger Fix for Docker Compatibility
- Tweaked `src/utils/logger.js`. You changed the output file to `../../app_debug.log`. This relative jump escapes `src/utils/` to hit the project root.
- Locally this works perfectly, but compiled inside your Docker `node:20-alpine` environment, relying exclusively on `__dirname, ../../` for filesystem creation can sometimes cause directory tree lookup bugs if the folder structure nests differently inside Linux depending on exactly how `package.json` vs `src/` is copied.
- **Fix:** Switched it dynamically to `path.join('/app', 'app_debug.log')` strictly during the `production` environment, while falling back to the local relative structure in dev mode.
### Docker Image Reliability Fix
- Patched `/Dockerfile` locally so that it correctly executes `touch /app/app_debug.log` prior to dropping its privileges to the restrictive `appuser` role.
- If we hadn't executed this `touch` as root, `fs.appendFileSync()` in `logger.js` would have crashed the Node application with a File Access Denied Exception (`EACCES`), as the non-root `appuser` would lack permission to independently create a new root-level file inside the `/app` Docker WORKDIR.
