/**
 * MÓDULO DE NOTIFICAÇÕES GLOBAIS (Toasts + Fila + Acessibilidade)
 */

const notificationQueue = [];
let isShowingNotification = false;
let notificationTemplate = null;

// Inicializa o template uma única vez
function initTemplate() {
    if (notificationTemplate) return;

    notificationTemplate = document.createElement('div');
    notificationTemplate.innerHTML = `
        <div class="notification-toast" role="alertdialog" aria-live="assertive" aria-atomic="true">
            <div class="notification-header">
                <span class="notification-icon"></span>
                <h4 class="notification-title"></h4>
                <button class="notification-close-btn" aria-label="Fechar notificação">×</button>
            </div>
            <p class="notification-message"></p>
        </div>
    `;
    document.body.appendChild(notificationTemplate);
}

/**
 * Exibe uma notificação em formato toast com fila e auto-close.
 * @param {string} message
 * @param {'info'|'success'|'error'} type
 * @param {string} title
 * @param {number} autoCloseMs - 0 para não fechar automaticamente (apenas em error toasts)
 */
export function showNotification(message, type = 'info', title = 'Aviso', autoCloseMs = 5000) {
    // Validação básica
    if (!['info', 'success', 'error'].includes(type)) type = 'info';

    // Adiciona à fila
    notificationQueue.push({ message, type, title, autoCloseMs });
    processQueue();
}

function processQueue() {
    if (isShowingNotification || notificationQueue.length === 0) return;

    isShowingNotification = true;
    initTemplate();

    const notif = notificationQueue.shift();
    const toast = notificationTemplate.firstElementChild.cloneNode(true);

    // Configurações por tipo
    const config = {
        info: { icon: 'ℹ️', color: '#3498db', defaultTitle: 'Aviso' },
        success: { icon: '✅', color: '#2ecc71', defaultTitle: 'Sucesso!' },
        error: { icon: '❌', color: '#e74c3c', defaultTitle: 'Erro!' }
    }[notif.type];

    const finalTitle = notif.title === 'Aviso' ? config.defaultTitle : notif.title;

    // Preenche conteúdo
    toast.querySelector('.notification-icon').textContent = config.icon;
    toast.querySelector('.notification-title').textContent = finalTitle;
    toast.querySelector('.notification-message').textContent = notif.message;

    // Estilo
    toast.style.borderLeft = `5px solid ${config.color}`;
    toast.querySelector('.notification-header').style.color = config.color;

    // ARIA
    toast.setAttribute('aria-labelledby', 'notification-title');
    toast.setAttribute('aria-describedby', 'notification-message');

    // Insere no DOM
    document.body.appendChild(toast);

    // Animação de entrada
    requestAnimationFrame(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(0)';
        });
    });

    // Logging
    console.log(`[NOTIFICAÇÃO:${notif.type.toUpperCase()}] ${finalTitle}: ${notif.message}`);

    // Auto-close
    let timeoutId = null;
    if (notif.type !== 'error' && notif.autoCloseMs > 0) {
        timeoutId = setTimeout(() => closeToast(toast), notif.autoCloseMs);
    }

    // Eventos de fechamento
    const closeBtn = toast.querySelector('.notification-close-btn');
    closeBtn.addEventListener('click', () => {
        if (timeoutId) clearTimeout(timeoutId);
        closeToast(toast);
    });

    // Fechar com ESC
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            if (timeoutId) clearTimeout(timeoutId);
            closeToast(toast);
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);

    // Fecha ao clicar fora (opcional)
    toast.addEventListener('click', (e) => {
        if (e.target === toast) closeToast(toast);
    });
}

function closeToast(toast) {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.addEventListener('transitionend', () => {
        if (toast.parentNode) {
            document.body.removeChild(toast);
        }
        isShowingNotification = false;
        processQueue(); // Próxima notificação
    });
}