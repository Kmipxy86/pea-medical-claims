FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 10001 app && mkdir -p /data/uploads && chown app /data/uploads
USER app
ENV UPLOAD_DIR=/data/uploads PORT=8080
COPY --from=build /out/api /usr/local/bin/api
EXPOSE 8080
CMD ["api"]
