# Experiment only. The build accesses public Alpine and npm registries.
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
RUN apk add --no-cache build-base linux-headers
WORKDIR /probe
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY filter.c ./
RUN cc -shared -fPIC -O2 -Wall -Werror -o /probe/filter.so /probe/filter.c

FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
WORKDIR /probe
COPY --from=build /probe/node_modules ./node_modules
COPY --from=build /probe/filter.so ./filter.so
COPY probe.mjs ./
USER node
ENTRYPOINT ["node", "/probe/probe.mjs"]
