# Snake60 本番運用手順

この手順は Ubuntu + systemd + Nginx を想定しています。

## 1. 配置

```bash
sudo mkdir -p /opt/snake60
sudo rsync -av --delete ./ /opt/snake60/
sudo chown -R www-data:www-data /opt/snake60
```

## 2. systemd サービス登録

```bash
sudo cp /opt/snake60/deploy/systemd/snake60.service /etc/systemd/system/snake60.service
sudo systemctl daemon-reload
sudo systemctl enable snake60
sudo systemctl start snake60
sudo systemctl status snake60
```

## 3. Nginx リバースプロキシ

```bash
sudo cp /opt/snake60/deploy/nginx/snake60.conf /etc/nginx/sites-available/snake60.conf
sudo ln -sf /etc/nginx/sites-available/snake60.conf /etc/nginx/sites-enabled/snake60.conf
sudo nginx -t
sudo systemctl reload nginx
```

`server_name your-domain.example;` は実ドメインに変更してください。

## 4. TLS(HTTPS) 有効化

```bash
sudo certbot --nginx -d your-domain.example
```

TLS 適用後は HSTS を有効にしてください（`max-age` は段階的に増やす）。

## 5. ヘルスチェック

```bash
curl -fsS http://127.0.0.1:8080/api/health
curl -fsS https://your-domain.example/api/health
```

どちらも `{"status":"ok"}` が返れば正常です。

## 6. 運用チェックコマンド

```bash
sudo journalctl -u snake60 -n 200 --no-pager
curl -fsS https://your-domain.example/api/scores | head
```

## 7. ロールバック方法

更新に問題が出た場合は、前バージョンを `/opt/snake60` に戻して再起動します。

```bash
sudo systemctl restart snake60
sudo systemctl status snake60
```

Nginx設定も戻す場合:

```bash
sudo cp /etc/nginx/sites-available/snake60.conf.bak /etc/nginx/sites-available/snake60.conf
sudo nginx -t
sudo systemctl reload nginx
```
