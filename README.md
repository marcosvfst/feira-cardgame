# Feira Cardgame - Demo

Este é um protótipo minimal de um card game usando Phaser 3. Ele implementa:
- Decks de 10 cartas com até 3 duplicatas
- 3 fases por round: compra, colocar monstros, efeitos
- 3 slots de campo por jogador
- Cartas placeholder (retângulos coloridos) com energia, habilidades e efeitos
- Oponente bot simples

Como rodar localmente:

1. Instale dependências (opcional, você pode abrir index.html diretamente):

```bash
npm install
npm start
# Abra http://localhost:8080
```

2. Ou apenas abra `index.html` no navegador (algumas funcionalidades podem exigir servidor).

Arquivos principais:
- `index.html`
- `src/cards.js`
- `src/main.js`
- `src/style.css`

Para criar ou editar cartas, use `src/cards.js`. Esse arquivo concentra o catálogo, descrições, efeitos e a montagem dos decks.

Se quiser que eu adicione salvamento, gráficos ou polimento visual, diga e eu melhoro.
# feira-cardgame