FROM denoland/deno:2.6.6

WORKDIR /app

# Copy all source files
COPY deno.json deno.lock ./
COPY main.ts ./
COPY src/ ./src/

# Cache dependencies
RUN deno cache main.ts

# Run as non-root user (deno user is provided by the base image)
USER deno

# The MCP server uses stdio transport
# --allow-net: Required for HTTP requests to package registries
# --allow-env: Required for config path override via MCP_DEPENDENCY_VERSION_CONFIG
# --allow-read: Required for reading optional config file from ~/.config
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "main.ts"]
