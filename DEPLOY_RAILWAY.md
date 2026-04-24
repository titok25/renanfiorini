# Guia de Deploy na Railway via GitHub

## Pré-requisitos

- Conta no [GitHub](https://github.com)
- Conta na [Railway](https://railway.app)

---

## Passo 1 — Criar repositório no GitHub

1. Acesse [github.com/new](https://github.com/new)
2. Nome sugerido: `ranger-raptor-0km`
3. Deixe como **Privado** (recomendado, pois contém código de pagamento)
4. **Não** inicialize com README (o projeto já tem)
5. Clique em **Create repository**

### Enviar o projeto para o GitHub

```bash
# Dentro da pasta do projeto
git init
git add .
git commit -m "feat: projeto otimizado para Railway"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/ranger-raptor-0km.git
git push -u origin main
```

---

## Passo 2 — Criar projeto na Railway

1. Acesse [railway.app](https://railway.app) e faça login
2. Clique em **New Project**
3. Selecione **Deploy from GitHub repo**
4. Autorize o acesso ao GitHub se solicitado
5. Selecione o repositório `ranger-raptor-0km`
6. Clique em **Deploy Now**

---

## Passo 3 — Configurar variáveis de ambiente

No painel Railway, vá em **Variables** e adicione:

| Variável | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `FREEPAY_PUBLIC_KEY` | sua chave pública Freepay |
| `FREEPAY_SECRET_KEY` | sua chave secreta Freepay |
| `FREEPAY_POSTBACK_URL` | `https://SEU-DOMINIO.railway.app/webhook/freepay` |

> **Atenção:** A variável `PORT` é definida automaticamente pela Railway. Não precisa configurar.

---

## Passo 4 — Verificar o deploy

Após o deploy (geralmente 1-2 minutos):

1. Acesse a URL gerada pela Railway (ex: `https://ranger-raptor-0km.railway.app`)
2. Verifique o health check: `https://SEU-DOMINIO.railway.app/health`
3. Deve retornar: `{"status":"ok","uptime":...}`

---

## Passo 5 — Deploy automático (CI/CD)

A partir de agora, qualquer `git push` para a branch `main` fará deploy automático:

```bash
git add .
git commit -m "update: descrição da mudança"
git push origin main
```

---

## Estrutura de arquivos importantes

```
projeto/
├── server.js           # Servidor Express otimizado
├── index.html          # Página principal
├── package.json        # Dependências
├── railway.json        # Configuração Railway (health check, restart policy)
├── nixpacks.toml       # Configuração de build (Node.js 20)
├── Procfile            # Comando de start alternativo
├── .gitignore          # Arquivos ignorados pelo Git
├── .env.example        # Template de variáveis de ambiente
└── images/             # Imagens otimizadas
    ├── mobile_car*.webp    # Versões mobile (480px)
    ├── desktop_car*.webp   # Versões desktop (1200px)
    ├── blur_car*.webp      # Placeholders de baixa resolução
    ├── logo.webp           # Logo otimizado
    └── footer_logos.webp   # Footer otimizado (372KB → 29KB)
```

---

## Troubleshooting

### Build falha com "Cannot find module"
Execute localmente e commite o `package-lock.json`:
```bash
npm install
git add package-lock.json
git commit -m "fix: atualizar package-lock.json"
git push
```

### PIX não funciona em produção
Verifique se `FREEPAY_PUBLIC_KEY` e `FREEPAY_SECRET_KEY` estão configuradas nas variáveis da Railway.

### Imagens não carregam
Verifique se a pasta `images/` foi commitada no Git (não deve estar no `.gitignore`).
