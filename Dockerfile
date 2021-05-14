FROM node:14

WORKDIR /app

COPY . /app/

RUN npm install

EXPOSE 3000

CMD [ "npm", "run", "start" ]