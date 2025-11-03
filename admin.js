// =========================================
// ADMIN.JS 
// =========================================

// Importações do Firebase
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocs } from 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';

import { initUsersModule, showUsuariosView } from './admin/admin-users.js';
import { initDevicesModule, showDispositivosView } from './admin/admin-devices.js';
import { initHierarchyModule, showInstituicoesView } from './admin/admin-hierarchy.js';
import { showNotification } from './utils/notifications.js';

// Configuração do Firebase
const firebaseConfig = {
    apiKey: "AIzaSyAawMA2HjEgBZ5gYIawMYECTp0oN4hj6YE",
    authDomain: "temptracker-eb582.firebaseapp.com",
    projectId: "temptracker-eb582",
    storageBucket: "temptracker-eb582.firebasestorage.app",
    messagingSenderId: "1079337208340",
    appId: "1:1079337208340:web:0b86faa43e141f0ff1b501"
};

// Inicialização
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- Variáveis Globais de Permissão ---
let currentUserLevel = null;
let currentUserInstitutions = [];
let loggedInUserId = null; 

// --- Cache de Hierarquia ---
const hierarchyCache = {
    instituicoes: [],
    unidades: [],
    setores: []
};

// --- Elementos da DOM ---
const userNameEl = document.getElementById('user-name');
const userLevelEl = document.getElementById('user-level');

// =========================================
// BARREIRA DE SEGURANÇA (AUTH GUARD)
// =========================================
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }
    
    loggedInUserId = user.uid; 
    
    const userDocRef = doc(db, "usuarios", user.uid);
    const userDoc = await getDoc(userDocRef);
    if (!userDoc.exists()) {
        window.location.href = "index.html";
        return;
    }
    const userData = userDoc.data();
    const nivel = userData.nivel;

    if (nivel !== 'superAdmin' && nivel !== 'admin') {
        // Usa a função importada
        showNotification("Acesso negado. Esta área é restrita para administradores.", 'error');
        // Redireciona após o usuário ver a mensagem
        setTimeout(() => {
            window.location.href = "index.html";
        }, 2500);
        return;
    }

    currentUserLevel = nivel;
    userNameEl.textContent = userData.nome || "Admin";
    userLevelEl.textContent = nivel;
    
    if (nivel === 'admin') {
        currentUserInstitutions = userData.acessoInstituicoes || [];
    }

    await loadHierarchyCache();
    initializeAdminPanel();
});

// =========================================
// INICIALIZAÇÃO DO APP E MÓDULOS
// =========================================
function initializeAdminPanel() {
    const navButtons = document.querySelectorAll('.admin-nav-btn');
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            navButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // "Injeção de Dependência": Passa as variáveis globais para os módulos
    const dependencies = {
        db: db,
        auth: auth,
        currentUserLevel: currentUserLevel,
        currentUserInstitutions: currentUserInstitutions,
        currentUserId: loggedInUserId, 
        hierarchyCache: hierarchyCache,
        loadHierarchyCache: loadHierarchyCache, 
        showNotification: showNotification 
    };
    
    initUsersModule(dependencies);
    initDevicesModule(dependencies);
    initHierarchyModule(dependencies);

    // Configura o "Roteamento"
    document.getElementById('nav-usuarios').addEventListener('click', showUsuariosView);
    document.getElementById('nav-instituicoes').addEventListener('click', showInstituicoesView);
    document.getElementById('nav-dispositivos').addEventListener('click', showDispositivosView);
    
    document.getElementById('nav-usuarios').classList.add('active');
    showUsuariosView();
}

/**
 * Carrega todas as instituições, unidades e setores na memória
 */
async function loadHierarchyCache() {
    try {
        const [instSnap, unitSnap, sectorSnap, deviceSnap] = await Promise.all([
            getDocs(collection(db, "instituicoes")),
            getDocs(collection(db, "unidades")),
            getDocs(collection(db, "setores")),
             getDocs(collection(db, "dispositivos"))
        ]);
        
        hierarchyCache.instituicoes = instSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        hierarchyCache.unidades = unitSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        hierarchyCache.setores = sectorSnap.docs.map(d => ({ id: d.id, ...d.data() }));
         hierarchyCache.dispositivos = deviceSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        
        console.log("Cache de hierarquia carregado/recarregado.");
         console.log(hierarchyCache); 
    } catch (error) {
        console.error("Erro ao carregar cache de hierarquia:", error);
        showNotification("Não foi possível carregar os dados de hierarquia. Tente recarregar a página.", "error");
    }
}

