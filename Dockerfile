FROM node:14

WORKDIR /

COPY . .

RUN npm install

EXPOSE 3000

CMD [ "npm", "run", "start" ]