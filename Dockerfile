# Use Node.js as the base image
FROM node:18-slim

# Install system dependencies (FFmpeg and Python for yt-dlp)
RUN apt-get update && \
    apt-get install -y ffmpeg python3 python3-pip curl && \
    rm -rf /var/lib/apt/lists/*

# Install yt-dlp globally
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

# Create app directory
WORKDIR /usr/src/app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application code
COPY . .

# Create the downloads directory
RUN mkdir -p downloads && chmod 777 downloads

# Set Environment Variables
ENV PORT=10000
ENV NODE_ENV=production

# Expose the port Render will use
EXPOSE 10000

# Start the server
CMD [ "node", "server.js" ]
