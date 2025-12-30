// sw.js - O vigia que roda em segundo plano
self.addEventListener('push', function(event) {
    const data = event.data ? event.data.json() : {
        titulo: "Nova Corrida!",
        corpo: "Abra o app para aceitar agora! ⚡"
    };

    const options = {
        body: data.corpo,
        icon: 'assets/icon.png', // Coloque um ícone aqui
        badge: 'assets/badge.png', // Ícone pequeno de notificação
        vibrate: [500, 110, 500, 110, 450, 110, 200, 110, 170, 40, 450, 110, 200, 110, 170, 40],
        data: { url: '/motoboy.html' }, // URL para abrir ao clicar
        tag: 'nova-corrida', // Evita empilhar várias notificações iguais
        renotify: true,
        requireInteraction: true // A notificação não some sozinha
    };

    event.waitUntil(
        self.registration.showNotification(data.titulo, options)
    );
});

// Ao clicar na notificação, abre o app
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.openWindow(event.notification.data.url)
    );
});