# Monitor de Processos Judiciais (Datajud CNJ)

Este é um aplicativo moderno e intuitivo desenvolvido para consulta e monitoramento de processos judiciais de todos os tribunais brasileiros, consumindo a base oficial de dados do **Datajud (Conselho Nacional de Justiça - CNJ)**.

A interface foi projetada utilizando a especificação do **Material 3 (Design System do Google)**, com suporte a temas responsivos, cantos arredondados elegantes e transições suaves.

## Funcionalidades

1. **Consulta Unificada:** Pesquise processos por **Número Único do Processo (CNJ)**, **Nome Completo da Parte** ou **CPF/CNPJ** em múltiplos tribunais em paralelo.
2. **Seleção de Tribunais:** Selecione nos quais deseja pesquisar, agrupados por categorias (Estadual, Federal, Trabalho, Superiores).
3. **Monitoramento Local:** Adicione processos de interesse à sua lista de monitoramento e mantenha as informações salvas diretamente no dispositivo (`localStorage`).
4. **Verificação de Atualizações:** Faça varreduras rápidas para checar se houve novas movimentações processuais. O app sinaliza com *badges* de novidades e notificações temporárias (*Snackbars*).
5. **Timeline de Movimentações:** Visualize a linha do tempo completa e detalhada com o histórico de andamento de cada processo, bem como suas partes envolvidas (polos ativo e passivo) e demais metadados.
6. **Modo de Demonstração (Simulador):** Equipado com um simulador de dados ativado por padrão. Permite testar buscas de nomes ("Aline Souza", "Carlos Eduardo", etc.) e receber atualizações em tempo real com dados fictícios ricos, mesmo sem uma chave de acesso configurada ou conexão com o servidor do CNJ.
7. **Importação e Exportação:** Salve seus processos monitorados exportando um arquivo JSON, ou restaure-os em outro dispositivo importando-os de volta.

---

## Estrutura do Projeto

* `server.js`: Servidor Node.js leve que serve os arquivos estáticos e atua como proxy para a API pública do Datajud, contornando problemas de CORS do navegador.
* `public/`: Contém a interface web (HTML, CSS customizado e lógica JS reativa).

---

## Como Executar o Aplicativo

Para rodar o aplicativo localmente em sua máquina, siga os passos abaixo:

### Pré-requisitos
* Ter o [Node.js](https://nodejs.org/) instalado na versão 18 ou superior.

### Passos
1. Abra o prompt de comando ou terminal na pasta deste projeto:
   `C:\Users\facil\.gemini\antigravity\scratch\datajud-monitor`
   
2. Caso ainda não tenha instalado as dependências (instaladas automaticamente durante a criação), execute:
   ```bash
   npm install
   ```
   
3. Inicie o servidor local:
   ```bash
   npm start
   ```
   
4. Abra o seu navegador e acesse:
   [http://localhost:3000](http://localhost:3000)

---

## Como utilizar a busca real na API do CNJ

Por padrão, a aplicação vem com o **Simulador** ligado para facilitar os testes rápidos. Se você deseja fazer consultas reais no banco de dados do CNJ:

1. No topo superior direito da tela, desligue a chave seletora **"Simulador"**.
2. Vá na aba de **Configurações** (no menu lateral) para gerenciar sua chave de acesso (se desejar usar uma chave própria). O proxy utilizará a chave pública oficial padrão do CNJ se o campo for mantido em branco.
3. Volte para a aba **Pesquisar Processos**, escolha o tribunal correto (por exemplo, `TJSP` para o Tribunal de Justiça de São Paulo), selecione o tipo de busca desejado e digite a sua consulta.
