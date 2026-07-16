# Imagem base oficial do Node.js
FROM node:18-alpine

# Definir o diretório de trabalho dentro do container
WORKDIR /app

# Copiar os arquivos de manifesto do pacote
COPY package*.json ./

# Instalar apenas dependências de produção (reduz o tamanho da imagem e aumenta segurança)
RUN npm install --only=production

# Copiar todo o restante dos arquivos do projeto
COPY . .

# Porta padrão exposta pelo container (o Cloud Run sobrescreve isso com a variável de ambiente PORT)
EXPOSE 3000

# Comando para iniciar o servidor
CMD ["node", "server.js"]
