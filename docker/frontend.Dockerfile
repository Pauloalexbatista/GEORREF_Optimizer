# Base Node image
FROM node:20-alpine

WORKDIR /app

# Copy package.json and package-lock.json
COPY frontend/package*.json ./

# Install dependencies
RUN npm install --legacy-peer-deps

# Copy the rest of the frontend code
COPY frontend/ .

# Build the Next.js app
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

ARG BACKEND_URL
ENV BACKEND_URL=$BACKEND_URL

RUN npm run build

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]

