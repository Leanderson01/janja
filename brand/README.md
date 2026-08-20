# Marca do Hydra

A fonte da verdade é `hydra-star.svg` — estrela branca de cinco pontas sobre
preto, com razão áurea (0.382) entre o raio interno e o externo, que é a
proporção da estrela clássica.

Os arquivos derivados **não são editados à mão**. Saem do script abaixo:

- `build/icon.png` (512×512) — o que o electron-builder usa no Linux/macOS
- `build/icon.ico` (16 a 256) — ícone do executável e do instalador no Windows
- `resources/icon.png` (512×512) — ícone da janela em tempo de execução
- `brand/hydra-1024.png` — versão grande, para uso fora do app

Dentro da interface, a estrela vem do componente
`src/renderer/src/components/brand/HydraMark.tsx`, que usa a mesma geometria mas
**sem o quadrado preto**: o app já tem fundo escuro, e o quadrado apareceria como
um bloco. O ícone do sistema precisa do quadrado porque é exibido sobre fundos
que não controlamos.

Para regerar tudo:

```bash
python3 brand/make-icons.py
```

`build/icon.icns` (macOS) continua sendo o antigo: o Pillow não escreve `.icns` e
o alvo do projeto é Windows. Se um dia importar, regerar numa máquina com
`iconutil` ou `png2icns`.
