import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

// Configuration for your specific Firebase Project
const firebaseConfig = {
    apiKey: "AIzaSyDtWZdtC-IeKDVyFqcwuqa_tn0hoH91dtc",
    authDomain: "terra-agnostum.firebaseapp.com",
    projectId: "terra-agnostum",
    storageBucket: "terra-agnostum.firebasestorage.app", 
    messagingSenderId: "809154092201",
    appId: "1:809154092201:web:95aaddd47c6ce021cf1db8"
};

export const appId = 'terra-agnostum-shared';

let app, auth, db, storage;
let isSyncEnabled = false;

try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);
    isSyncEnabled = true;
    
    const statusEl = document.getElementById('sync-status');
    if (statusEl) {
        statusEl.innerText = "SYNC: READY";
        statusEl.style.color = "var(--term-amber)";
    }
} catch (e) {
    const statusEl = document.getElementById('sync-status');
    if (statusEl) statusEl.innerText = "SYNC: OFFLINE";
}

export { app, auth, db, storage, isSyncEnabled };