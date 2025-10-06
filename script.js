import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

let camera, scene, renderer, labelRenderer;
let ramGroups = [];
let trayGroups = [];
let currentPerc = null;
let triggers = [];
let ramBlinking = false;
let mixers = [];
let clock = new THREE.Clock();
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();

// --- Animation RAM ---
let ramTargetPositions = [];
let ramActiveGroups = [];
let ramAnimSpeed = 0.1;

// --- Kamera Animation ---
let cameraAnimation = null;

// --- PERC Label ---
let percLabel = null;
let ramLabelObject = null; // global

let currentTextCube = null;

let pointerDown = false;
let pointerDownPos = { x: 0, y: 0 };
let pointerDownTime = 0;
let pointerMoved = false;
const moveThreshold = 5; // Pixel: ab hier gilt es als Drag (Kamera)
const shortPressThreshold = 250; // ms: kurze Press -> Auswahl

// --- Blinking Materials ---
const blinkingMaterials = []; // Materialien, die blinken sollen
const blinkingConfig = {
    speed: 2.0,        // Puls-Frequenz (höher = schneller)
    amplitude: 0.8,    // Stärke des Pulses (0..1)
    baseMultiplier: 0.6 // Multiplikator für die Basis-EmissiveIntensity (falls keine userData vorhanden)
};

init();

function init() {
    // Kamera
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 20);
    camera.position.set(1.5, 1.2, 1.5);
    camera.lookAt(0, 0, 0);

    // Szene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xaaaaaa);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth - 250, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('scene-container').appendChild(renderer.domElement);

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);

    // Label Renderer
    labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(window.innerWidth - 250, window.innerHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0px';
    labelRenderer.domElement.style.pointerEvents = 'none';
    document.getElementById('scene-container').appendChild(labelRenderer.domElement);

    // Resize
    window.addEventListener('resize', () => {
        camera.aspect = (window.innerWidth - 250) / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth - 250, window.innerHeight);
        labelRenderer.setSize(window.innerWidth - 250, window.innerHeight);
    });

    // Licht
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
    keyLight.position.set(2, 3, 2);
    keyLight.castShadow = true;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 1.0);
    fillLight.position.set(-2, 1, 2);
    scene.add(fillLight);

    const backLight = new THREE.DirectionalLight(0xffffff, 0.8);
    backLight.position.set(0, 2, -3);
    scene.add(backLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    // Lade GLB Modell
    const loader = new GLTFLoader();
    loader.load('models/glb/server.glb', gltf => {
        const object = gltf.scene;
        object.scale.setScalar(0.012);

        object.traverse(child => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;

                // RAM gruppieren
                if (child.name.startsWith('RAM')) {
                    const match = child.name.match(/^RAM(\d+)_\d+$/);
                    if (match) {
                        const index = parseInt(match[1]);
                        if (!ramGroups[index]) ramGroups[index] = [];
                        ramGroups[index].push(child);

                        if (child.material) {
                            if (Array.isArray(child.material)) {
                                child.material.forEach(m => m.userData.baseEmissive = m.color.clone());
                            } else {
                                child.material.userData.baseEmissive = child.material.color.clone();
                            }
                        }
                    }
                }

                // Tray gruppieren
                if (child.name.startsWith('Tray')) {
                    const match = child.name.match(/^Tray(\d+)_\d+$/);
                    if (match) {
                        const index = parseInt(match[1]);
                        if (!trayGroups[index]) trayGroups[index] = [];
                        trayGroups[index].push(child);
                    }
                }

                // Trigger speichern
                if (child.name.match(/^RAM_Trigger\d{3}$/)) {
                    triggers.push(child);
                }

                if (child.material) {
                    makeEmissive(child.material);
                    enhanceMaterial(child.material);
                }

                // PSU Label
                if (child.name === 'PSU000_1') createLabelForPSU(child);
                // PERC Label
                if (child.name === 'PERCDUMMY') createLabelForPERC(child);
            }
        });

        // Nach dem Traversal: suche Material.017 und starte das Blinken
        collectAndStartBlinkingByName(object, 'Material.017');
        collectAndStartBlinkingByName(object, 'Material.029');

        scene.add(object);

        // Animationen starten
        if (gltf.animations && gltf.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(object);
            gltf.animations.forEach(clip => mixer.clipAction(clip).play());
            mixers.push(mixer);
        }

        // RAM Zielpositionen
        storeRamTargetPositions();

        // Dropdowns
        populateRamDropdown('ramCount', ramGroups.length);
        populateTrayDropdown('trayCount', trayGroups.length);
        populateDropdown('percSelect', 2, 1, true);

        // Event Listener
        document.getElementById('ramCount').addEventListener('change', e => {
            const count = parseInt(e.target.value);
            ramGroups.forEach((_, i) => setRAMGroupActive(i, i < count));
        });
        document.getElementById('trayCount').addEventListener('change', e => updateVisibility(trayGroups, parseInt(e.target.value)));
        document.getElementById('percSelect').addEventListener('change', loadPerc);

        window.addEventListener('pointerdown', onPointerDown);

        window.addEventListener('keydown', (event) => {
            if (event.code === 'Space') { // Leertaste
                const psu = scene.getObjectByName('PSU000_1');
                if (psu) {
                    onPSUClick(psu);
                }
            } else if (event.code === 'KeyC') {
                onCpuClick();
            }
        });
    });

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.minDistance = 0.4;
    controls.maxDistance = 0.8;
    controls.enablePan = false;
    controls.minPolarAngle = Math.PI / 6;
    controls.maxPolarAngle = Math.PI / 2.3;
    controls.update();
    controls.saveState();

    renderer.setAnimationLoop(animate);
    createLabelForRAMAtOrigin();

    const storageLabelObject = createLabelForStorage();
    scene.add(storageLabelObject);
    storageLabelObject.position.set(0, 0, .2); // beliebige Position

    // Dropdown für CPU
    document.getElementById('cpuSelect').addEventListener('change', (e) => {
        const cpuName = e.target.value;
        if (!cpuName) return;
        onCpuSelect(cpuName);
    });
}

function createTextCube(text, width = 0.5, height = 0.2, depth = 0.3) {
    const geometry = new THREE.BoxGeometry(width, height, depth);

    // Falls "Intel Xeon" vorkommt → Zeilenumbruch hinzufügen
    if (text.includes("Intel Xeon")) {
        text = text.replace("Intel Xeon", "Intel Xeon\n");
    }

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    // Hintergrund
    ctx.fillStyle = 'rgba(136,136,136,1)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Text-Einstellungen
    ctx.fillStyle = 'white';
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Mehrzeiligen Text zeichnen
    const lines = text.split("\n");
    const lineHeight = 34;
    const centerY = canvas.height / 2 - ((lines.length - 1) * lineHeight) / 2;

    lines.forEach((line, i) => {
        ctx.fillText(line, canvas.width / 2, centerY + i * lineHeight);
    });

    const texture = new THREE.CanvasTexture(canvas);

    const materials = [
        new THREE.MeshPhongMaterial({ color: 0x444444 }), // rechts
        new THREE.MeshPhongMaterial({ color: 0x444444 }), // links
        new THREE.MeshPhongMaterial({ color: 0x444444 }), // oben
        new THREE.MeshPhongMaterial({ color: 0x444444 }), // unten
        new THREE.MeshPhongMaterial({ map: texture }),   // vorne
        new THREE.MeshPhongMaterial({ color: 0x444444 })  // hinten
    ];

    return new THREE.Mesh(geometry, materials);
}

function onCpuSelect(cpuName) {
    console.log("CPU ausgewählt:", cpuName);

    // Wenn bereits ein TextCube existiert, entfernen
    if (currentTextCube) {
        scene.remove(currentTextCube);
        if (currentTextCube.material) {
            currentTextCube.material.forEach(mat => {
                if (mat.map) mat.map.dispose();
                mat.dispose();
            });
        }
        currentTextCube.geometry.dispose();
        currentTextCube = null;
    }
    const heatsinks = [];
    scene.traverse(obj => {
        if (obj.name.startsWith('Heatsinks') && obj.isMesh) {
            heatsinks.push(obj);
            // Material transparent machen
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => {
                        m.transparent = true;
                        m.opacity = 0.1;
                    });
                } else {
                    obj.material.transparent = true;
                    obj.material.opacity = 0.1;
                }
            }

            const bbox = new THREE.Box3().setFromObject(obj);
            // Bounding Box berechnen
            const max = bbox.max;
            const min = bbox.min;

            const textCube = createTextCube(cpuName);

            textCube.rotation.x = -Math.PI / 2;
            textCube.position.set(
                -.070,
                max.y + 0.0005,
                (min.z + max.z) / 2
            );

            // Größe anpassen
            textCube.scale.set(0.05, 0.1, 0.01);

            scene.add(textCube);
        }
    });
}

function onCpuClick() {
    const heatsinks = [];
    scene.traverse(obj => {
        if (obj.name.startsWith('Heatsinks') && obj.isMesh) {
            heatsinks.push(obj);
            // Material transparent machen
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => {
                        m.transparent = true;
                        m.opacity = 0.1;
                    });
                } else {
                    obj.material.transparent = true;
                    obj.material.opacity = 0.1;
                }
            }

            const bbox = new THREE.Box3().setFromObject(obj);
            // Bounding Box berechnen
            const max = bbox.max;
            const min = bbox.min;

            const textCube = createTextCube("Xeon E5");

            textCube.rotation.x = -Math.PI / 2;
            textCube.position.set(
                -.070,
                max.y + 0.000025,
                (min.z + max.z) / 2
            );

            // Größe anpassen
            textCube.scale.set(0.05, 0.1, 0.01);

            scene.add(textCube);
        }
    });

    if (heatsinks.length === 0) return;

    // Berechne die zentrale Position aller Heatsinks
    const center = new THREE.Vector3();
    heatsinks.forEach(h => center.add(h.getWorldPosition(new THREE.Vector3())));
    center.divideScalar(heatsinks.length);

    // Kamera Zielposition direkt über die Heatsinks
    const targetHeight = 0.25;
    const targetPosition = center.clone();
    targetPosition.y += targetHeight;

    const startPosition = camera.position.clone();
    const duration = 1.5;
    let elapsed = 0;

    cameraAnimation = (delta) => {
        elapsed += delta;
        const t = Math.min(elapsed / duration, 1);
        const ease = t * t * (3 - 2 * t); // Smoothstep

        camera.position.lerpVectors(startPosition, targetPosition, ease);
        camera.lookAt(center);

        if (t >= 1) cameraAnimation = null;
    };
}

// --- Labels ---
function createLabelForRAMAtOrigin() {
    const div = document.createElement('div');
    div.className = 'label';
    div.textContent = 'RAM\n64GB DDR4 (4x 16GB DIMM)';
    div.style.whiteSpace = 'pre';
    div.style.backgroundColor = 'rgba(0,0,0,0.7)'; // Standardfarbe
    div.style.color = 'white';
    div.style.padding = '4px 8px';
    div.style.borderRadius = '8px';
    div.style.fontSize = '12px';
    div.style.textAlign = 'center';

    const arrow = document.createElement('div');
    arrow.style.position = 'absolute';
    arrow.style.bottom = '-6px';
    arrow.style.left = '50%';
    arrow.style.transform = 'translateX(-50%)';
    arrow.style.width = '0';
    arrow.style.height = '0';
    arrow.style.borderLeft = '6px solid transparent';
    arrow.style.borderRight = '6px solid transparent';
    arrow.style.borderTop = '6px solid rgba(0,0,0,0.7)';
    div.appendChild(arrow);

    const label = new CSS2DObject(div);
    label.position.set(0, .01, 0);
    scene.add(label);

    ramLabelObject = div; // speichern für spätere Farbänderung
}

function createLabelForPSU(object) {
    const div = document.createElement('div');
    div.className = 'label';
    div.textContent = 'Power Supply Unit';
    div.style.backgroundColor = 'rgba(0,0,0,0.7)';
    div.style.color = 'white';
    div.style.padding = '4px 8px';
    div.style.borderRadius = '8px';
    div.style.fontSize = '12px';
    div.style.position = 'relative';

    const arrow = document.createElement('div');
    arrow.style.position = 'absolute';
    arrow.style.bottom = '-6px';
    arrow.style.left = '50%';
    arrow.style.transform = 'translateX(-50%)';
    arrow.style.width = '0';
    arrow.style.height = '0';
    arrow.style.borderLeft = '6px solid transparent';
    arrow.style.borderRight = '6px solid transparent';
    arrow.style.borderTop = '6px solid rgba(0,0,0,0.7)';
    div.appendChild(arrow);

    const label = new CSS2DObject(div);
    label.position.set(0, 0.05, 0);
    object.add(label);
}

function createLabelForStorage() {
    const emptyObject = new THREE.Object3D();

    // Label-Div erstellen
    const div = document.createElement('div');
    div.className = 'label';
    div.textContent = 'Storage';
    div.style.backgroundColor = 'rgba(0,0,0,0.7)';
    div.style.color = 'white';
    div.style.padding = '4px 8px';
    div.style.borderRadius = '8px';
    div.style.fontSize = '12px';
    div.style.position = 'relative';

    // Pfeil hinzufügen
    const arrow = document.createElement('div');
    arrow.style.position = 'absolute';
    arrow.style.bottom = '-6px';
    arrow.style.left = '50%';
    arrow.style.transform = 'translateX(-50%)';
    arrow.style.width = '0';
    arrow.style.height = '0';
    arrow.style.borderLeft = '6px solid transparent';
    arrow.style.borderRight = '6px solid transparent';
    arrow.style.borderTop = '6px solid rgba(0,0,0,0.7)';
    div.appendChild(arrow);

    // CSS2DObject erstellen und an leeres Objekt binden
    const label = new CSS2DObject(div);
    label.position.set(0, 0.05, 0);
    emptyObject.add(label);

    // Das leere Objekt zurückgeben, damit man es in die Szene setzen kann
    return emptyObject;
}

// --- PERC Label immer sichtbar ---
function createLabelForPERC(object) {
    const div = document.createElement('div');
    div.className = 'label perc-label';
    div.style.display = 'flex';
    div.style.flexDirection = 'column';
    div.style.alignItems = 'center';
    div.style.backgroundColor = 'rgba(0,0,0,0.7)';
    div.style.color = 'white';
    div.style.padding = '4px 8px';
    div.style.borderRadius = '8px';
    div.style.fontSize = '12px';
    div.style.position = 'relative';

    // Warnung
    const warning = document.createElement('div');
    warning.textContent = '!';
    warning.style.backgroundColor = 'red';
    warning.style.color = 'white';
    warning.style.fontWeight = 'bold';
    warning.style.borderRadius = '50%';
    warning.style.width = '16px';
    warning.style.height = '16px';
    warning.style.display = 'flex';
    warning.style.alignItems = 'center';
    warning.style.justifyContent = 'center';
    warning.style.marginBottom = '4px';
    div.appendChild(warning);

    // Text
    const text = document.createElement('span');
    text.textContent = 'Kein PERC ausgewählt'; // Default Text
    div.appendChild(text);

    // Spinner
    const spinner = document.createElement('div');
    spinner.style.border = '3px solid rgba(255,255,255,0.3)';
    spinner.style.borderTop = '3px solid white';
    spinner.style.borderRadius = '50%';
    spinner.style.width = '12px';
    spinner.style.height = '12px';
    spinner.style.marginTop = '4px';
    spinner.style.animation = 'spin 1s linear infinite';
    spinner.style.display = 'none';
    div.appendChild(spinner);

    // Label Object in Szene
    const labelObject = new THREE.Object3D();
    labelObject.position.set(.08, .015, -.09);
    scene.add(labelObject);

    const label = new CSS2DObject(div);
    label.position.set(0, 0.01, 0);
    labelObject.add(label);

    percLabel = { label, text, spinner, warning, parent: labelObject };
}

// --- Pointer Event ---
function onPointerDown(event) {
    // Pointer nur im rendering-canvas verfolgen (falls nötig)
    pointerDown = true;
    pointerMoved = false;
    pointerDownTime = performance.now();
    pointerDownPos.x = event.clientX;
    pointerDownPos.y = event.clientY;

    // optional: Pointer Capture um Move/Up zuverlässig zu bekommen
    try {
        if (event.target && event.target.setPointerCapture) {
            event.target.setPointerCapture(event.pointerId);
        }
    } catch (e) {
        // ignore
    }
}

function onPointerMove(event) {
    if (!pointerDown) return;

    const dx = event.clientX - pointerDownPos.x;
    const dy = event.clientY - pointerDownPos.y;
    const dist = Math.hypot(dx, dy);
    if (dist > moveThreshold) {
        pointerMoved = true;
    }
}

function onPointerUp(event) {
    if (!pointerDown) return;
    pointerDown = false;

    // Release Pointer Capture
    try {
        if (event.target && event.target.releasePointerCapture) {
            event.target.releasePointerCapture(event.pointerId);
        }
    } catch (e) {
        // ignore
    }

    const duration = performance.now() - pointerDownTime;
    const isShortPress = duration < shortPressThreshold;
    const isSmallMove = !pointerMoved;

    // Wenn kurze Press ODER kaum Bewegung -> Auswahl behandeln
    if (isShortPress || isSmallMove) {
        // Normierte Maus-Koordinaten relativ zum Renderer-Canvas:
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);

        // RAM-Trigger prüfen
        const intersects = raycaster.intersectObjects(triggers, true);
        if (intersects.length > 0) {
            // Auswahl bestätigt — RAM-Blinken starten (wie zuvor)
            ramBlinking = true;
            if (ramLabelObject) {
                ramLabelObject.style.backgroundColor = 'rgb(248, 154, 75)';
            }
            // optional: du kannst hier noch weitere Logiken ergänzen,
            // z.B. welche RAM-Gruppe genau ausgewählt wurde oder Toggle-Verhalten
        }

        // PSU prüfen (falls du PSU per Klick aktivieren willst)
        const psu = scene.getObjectByName('PSU000_1');
        if (psu) {
            const psuIntersects = raycaster.intersectObject(psu, true);
            if (psuIntersects.length > 0) {
                onPSUClick(psuIntersects[0].object);
            }
        }
    } else {
        // Wahrscheinlich Kameradreh: nichts tun (OrbitControls macht seine Arbeit)
    }
}

function onPointerCancel(event) {
    // Falls Pointer abgebrochen wurde
    pointerDown = false;
    pointerMoved = false;
}

// --- PSU Kamera Animation ---
function onPSUClick(object) {
    const targetPosition = new THREE.Vector3(-0.25, 0.25, -0.5);
    const center = new THREE.Vector3(0, 0, 0);

    const startOffset = camera.position.clone().sub(center);
    const endOffset = targetPosition.clone().sub(center);

    const axis = new THREE.Vector3().crossVectors(startOffset, endOffset).normalize();
    let angle = startOffset.angleTo(endOffset);

    const duration = 1.5;
    let elapsed = 0;

    cameraAnimation = (delta) => {
        elapsed += delta;
        const t = Math.min(elapsed / duration, 1);
        const ease = t * t * (3 - 2 * t);

        const q = new THREE.Quaternion();
        q.setFromAxisAngle(axis, ease * angle);

        const newOffset = startOffset.clone().applyQuaternion(q);
        camera.position.copy(center.clone().add(newOffset));
        camera.lookAt(center);

        if (t >= 1) cameraAnimation = null;
    };
}

// --- Dropdowns ---
function populateRamDropdown(id, max) {
    const select = document.getElementById(id);
    select.innerHTML = '';
    for (let i = 0; i <= max; i += 2) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = i;
        select.appendChild(opt);
    }
    select.value = 0;
}

function populateTrayDropdown(id, max) {
    const select = document.getElementById(id);
    select.innerHTML = '';
    for (let i = 0; i <= max; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = i;
        select.appendChild(opt);
    }
    select.value = 0;
}

function populateDropdown(id) {
    const select = document.getElementById(id);
    select.innerHTML = '';

    // Kein PERC
    const noneOption = document.createElement('option');
    noneOption.value = '';
    noneOption.textContent = 'Kein PERC';
    select.appendChild(noneOption);

    // PERC Optionen
    const percs = ['H330', 'H730', 'SPHERE'];
    percs.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
    });

    // Default: Kein PERC
    select.value = '';
}

// --- RAM Animation ---
function storeRamTargetPositions() {
    ramGroups.forEach((group, i) => {
        if (!group) return;
        if (!ramTargetPositions[i]) ramTargetPositions[i] = [];
        group.forEach(obj => {
            ramTargetPositions[i].push(obj.position.clone());
            obj.position.z = -50;
        });
    });
}

function setRAMGroupActive(groupIndex, active) {
    ramActiveGroups[groupIndex] = active;
}

function animateRAMMovement() {
    ramGroups.forEach((group, i) => {
        if (!group) return;
        const active = ramActiveGroups[i];
        group.forEach((obj, j) => {
            if (!obj) return;
            const targetZ = active ? ramTargetPositions[i][j].z : -50;
            const distance = targetZ - obj.position.z;
            obj.position.z += distance * Math.pow(ramAnimSpeed, 0.5) * Math.sign(distance);
        });
    });
}

// --- Trays ---
function updateVisibility(groups, count) {
    groups.forEach((group, i) => {
        if (!group) return;
        group.forEach(obj => obj.visible = i < count);
    });
}

// --- Material ---
function makeEmissive(material) {
    if (Array.isArray(material)) {
        material.forEach(m => {
            if (!m.userData) m.userData = {};
            // setze baseEmissive wenn noch nicht gesetzt
            if (!m.userData.baseEmissive) m.userData.baseEmissive = (m.color ? m.color.clone() : new THREE.Color(0x000000));
            // setze emissive und eine moderate emissiveIntensity
            m.emissive = m.userData.baseEmissive.clone();
            if (typeof m.emissiveIntensity === 'undefined') m.emissiveIntensity = blinkingConfig.baseMultiplier;
        });
    } else {
        if (!material.userData) material.userData = {};
        if (!material.userData.baseEmissive) material.userData.baseEmissive = (material.color ? material.color.clone() : new THREE.Color(0x000000));
        material.emissive = material.userData.baseEmissive.clone();
        if (typeof material.emissiveIntensity === 'undefined') material.emissiveIntensity = blinkingConfig.baseMultiplier;
    }
}

function enhanceMaterial(material) {
    if (Array.isArray(material)) {
        material.forEach(m => {
            m.metalness = 0.3;
            m.roughness = 0.5;
        });
    } else {
        material.metalness = 0.3;
        material.roughness = 0.5;
    }
}

// --- Blinking Material Helpers ---
/**
 * Sucht im gegebenen Objekt (und seinen Kindern) nach Materialien mit dem gegebenen Namen
 * und fügt diese der blinkingMaterials-Liste hinzu.
 * Name-Vergleich nutzt material.name (falls vorhanden) und auch material.userData.nameFallback (falls gesetzt).
 */
function collectAndStartBlinkingByName(rootObject, materialName) {
    const found = [];
    rootObject.traverse(child => {
        if (child.isMesh && child.material) {
            if (Array.isArray(child.material)) {
                child.material.forEach(m => {
                    if (m && (m.name === materialName || (m.userData && m.userData.name === materialName))) {
                        addBlinkingMaterial(m);
                        found.push(m);
                    }
                });
            } else {
                const m = child.material;
                if (m && (m.name === materialName || (m.userData && m.userData.name === materialName))) {
                    addBlinkingMaterial(m);
                    found.push(m);
                }
            }
        }
    });

    if (found.length === 0) {
        rootObject.traverse(child => {
            if (child.isMesh && child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => {
                        if (m && m.name && m.name.includes(materialName)) addBlinkingMaterial(m);
                    });
                } else {
                    const m = child.material;
                    if (m && m.name && m.name.includes(materialName)) addBlinkingMaterial(m);
                }
            }
        });
    }

    // Falls immer noch nichts gefunden: logge es (du kannst das entfernen)
    if (blinkingMaterials.length === 0) {
        console.warn(`Kein Material mit Namen "${materialName}" gefunden.`);
    } else {
        console.log(`Blinkende Materialien gefunden:`, blinkingMaterials.map(m => m.name || m.uuid));
    }
}

function addBlinkingMaterial(mat) {
    if (!mat) return;
    if (!mat.userData) mat.userData = {};
    // Stelle sicher, dass baseEmissive gesetzt ist
    if (!mat.userData.baseEmissive) {
        mat.userData.baseEmissive = (mat.color ? mat.color.clone() : new THREE.Color(0x000000));
        mat.emissive = mat.userData.baseEmissive.clone();
    }
    // Standard intensity falls nicht vorhanden
    if (typeof mat.userData.baseEmissiveIntensity === 'undefined') {
        mat.userData.baseEmissiveIntensity = (typeof mat.emissiveIntensity !== 'undefined') ? mat.emissiveIntensity : blinkingConfig.baseMultiplier;
    }
    // Vermeide doppelte Einträge
    if (!blinkingMaterials.includes(mat)) blinkingMaterials.push(mat);
}

/**
 * Optional: öffentliche Funktion, um ein Material später per Name zu starten
 */
function startBlinkingMaterialByName(materialName) {
    collectAndStartBlinkingByName(scene, materialName);
}

/**
 * Optional: stoppe das Blinken eines Materials
 */
function stopBlinkingMaterial(mat) {
    const idx = blinkingMaterials.indexOf(mat);
    if (idx !== -1) blinkingMaterials.splice(idx, 1);
}

// --- Animate ---
function animate(time) {
    const delta = clock.getDelta();

    if (cameraAnimation) cameraAnimation(delta);

    // Zeit für Puls (in Sekunden)
    const t = clock.getElapsedTime();
    // pulse zwischen 0..1 im Sinus
    const pulse = 0.5 * (1 + Math.sin(t * blinkingConfig.speed * Math.PI * 2)); // 0..1
    const intensityMultiplier = 1.0 + blinkingConfig.amplitude * (pulse - 0.5) * 2; // schwankt etwa um 1

    // Anwenden auf alle blinkingMaterials
    if (blinkingMaterials.length > 0) {
        blinkingMaterials.forEach(m => {
            if (!m) return;
            // Basiswert
            const base = (m.userData && typeof m.userData.baseEmissiveIntensity !== 'undefined') ? m.userData.baseEmissiveIntensity : blinkingConfig.baseMultiplier;
            // Setze emissive (Farbe) falls nicht gesetzt
            if (!m.emissive && m.userData && m.userData.baseEmissive) {
                m.emissive = m.userData.baseEmissive.clone();
            } else if (!m.emissive && m.color) {
                m.emissive = m.color.clone();
            }
            // Aktualisiere intensity
            m.emissiveIntensity = Math.max(0, base * intensityMultiplier);
            // Falls du einen zusätzlichen, sichtbaren Leuchteffekt brauchst, kannst du hier die emissive-Farbe aufleuchten lassen:
            // const blinkColor = m.userData.baseEmissive.clone().multiplyScalar(1.0 + 0.5 * pulse);
            // m.emissive.copy(blinkColor);
        });
    }

    // Zusätzlich: falls ramBlinking aktiv ist, blinke RAM-Gruppen (wie vorher)
    if (ramBlinking) {
        const ramPulse = 1.0 + 0.5 * Math.sin(time * 0.005);
        ramGroups.forEach(group => {
            if (!group) return;
            group.forEach(obj => {
                if (!obj || !obj.material) return;
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => {
                        if (m.userData && m.userData.baseEmissive) {
                            m.emissive.copy(m.userData.baseEmissive);
                            m.emissiveIntensity = ramPulse;
                        }
                    });
                } else {
                    if (obj.material.userData && obj.material.userData.baseEmissive) {
                        obj.material.emissive.copy(obj.material.userData.baseEmissive);
                        obj.material.emissiveIntensity = ramPulse;
                    }
                }
            });
        });
    }

    animateRAMMovement();
    mixers.forEach(mixer => mixer.update(delta));

    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
}

// --- Perc Loader ---
function loadPerc(e) {
    const percIndex = e.target.value;
    const dummyPerc = scene.getObjectByName('PERCDUMMY');
    if (!dummyPerc) return;

    // altes PERC entfernen
    if (currentPerc) {
        scene.remove(currentPerc);
        currentPerc.traverse(child => {
            if (child.isMesh) {
                child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(mat => mat.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            }
        });
        currentPerc = null;
    }

    // Kein PERC ausgewählt
    if (!percIndex) {
        dummyPerc.visible = true;
        if (percLabel) {
            percLabel.spinner.style.display = 'none';
            percLabel.warning.style.display = 'flex';
            percLabel.text.textContent = 'Kein PERC ausgewählt';
        }
        return;
    }

    // Ladeprozess starten
    dummyPerc.visible = false;
    if (percLabel) {
        percLabel.spinner.style.display = 'block';
        percLabel.warning.style.display = 'none';
        percLabel.text.textContent = `PERC Controller ${percIndex}`;
    }

    const path = `models/glb/perc/`;
    const glbFile = `perc_${percIndex}.glb`;

    const loaderGLB = new GLTFLoader();
    loaderGLB.setPath(path).load(glbFile, gltf => {
        const perc = gltf.scene;
        perc.position.set(0.08, 0.015, -0.09);
        perc.rotation.copy(dummyPerc.rotation);
        perc.scale.set(0.025, 0.025, 0.025);

        perc.traverse(child => {
            if (child.isMesh && child.material) {
                // ✅ Nur Eigenschaften ergänzen, NICHT ersetzen
                if (child.material.isMeshStandardMaterial || child.material.isMeshPhysicalMaterial) {
                    // Leichte Emission hinzufügen (ohne Texturen zu überschreiben)
                    child.material.emissive = new THREE.Color(0x222222);
                    child.material.emissiveIntensity = 0.2;

                    // Optionale Optimierungen für PBR
                    child.material.needsUpdate = true;
                }
            }
        });

        currentPerc = perc;
        scene.add(perc);

        if (percLabel) percLabel.spinner.style.display = 'none';
    }, undefined, error => {
        console.error('Fehler beim Laden des Perc:', error);
        if (percLabel) {
            percLabel.spinner.style.display = 'none';
            percLabel.warning.style.display = 'flex';
            percLabel.text.textContent = 'Fehler beim Laden';
        }
        dummyPerc.visible = true;
    });
}
// --- CSS Spinner Keyframes ---
const style = document.createElement('style');
style.innerHTML = `
@keyframes spin {
    0% { transform: rotate(0deg);}
    100% { transform: rotate(360deg);}
}
`;
document.head.appendChild(style);