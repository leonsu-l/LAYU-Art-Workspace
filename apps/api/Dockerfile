# syntax=docker/dockerfile:1
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY apps/api/pom.xml ./pom.xml
COPY apps/api/src/main ./src/main
RUN --mount=type=cache,target=/root/.m2 mvn -B -ntp -DskipTests package

FROM eclipse-temurin:21-jre-alpine
RUN addgroup -S studio && adduser -S -G studio studio && mkdir -p /app/data && chown -R studio:studio /app
WORKDIR /app
COPY --from=build /build/target/studio-api-1.0.0.jar /app/studio-api.jar
USER studio
ENV BIND_ADDRESS=0.0.0.0 DATA_DIR=/app/data PORT=3001
EXPOSE 3001
ENTRYPOINT ["java", "-jar", "/app/studio-api.jar"]
