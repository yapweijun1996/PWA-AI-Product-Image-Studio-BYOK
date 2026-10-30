# Synthetic experiment only; never use this image as a broker.
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
RUN apk add --no-cache build-base
WORKDIR /probe
COPY peerprobe.c ./
RUN cc -O2 -Wall -Wextra -Werror -o peerprobe peerprobe.c

FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
COPY --from=build /probe/peerprobe /probe/peerprobe
USER 1001:1001
ENTRYPOINT ["/probe/peerprobe"]
