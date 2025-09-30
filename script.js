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
                if (child.name === 'PERC') createLabelForPERC(child);
            }
        });

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
}

// --- Labels ---
function createLabelForRAMAtOrigin() {
    const div = document.createElement('div');
    div.className = 'label';
    div.textContent = 'RAM\n64GB DDR4 (4x 16GB DIMM)';
    div.style.whiteSpace = 'pre';
    div.style.backgroundColor = 'rgba(0,0,0,0.7)';
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
    warning.style.marginRight = '4px'; // neben Text
    div.appendChild(warning);

    const text = document.createElement('span');
    text.textContent = 'PERC Controller'; // wird beim Laden aktualisiert
    div.appendChild(text);

    const spinner = document.createElement('div');
    spinner.style.border = '3px solid rgba(255,255,255,0.3)';
    spinner.style.borderTop = '3px solid white';
    spinner.style.borderRadius = '50%';
    spinner.style.width = '12px';
    spinner.style.height = '12px';
    spinner.style.marginLeft = '4px'; // neben Text
    spinner.style.animation = 'spin 1s linear infinite';
    spinner.style.display = 'none';
    div.appendChild(spinner);

    const labelObject = new THREE.Object3D();
    labelObject.position.set(.08, .015, -.09);
    scene.add(labelObject); // Label hängt direkt an Szene, nicht am Dummy

    const label = new CSS2DObject(div);
    label.position.set(0, 0.01, 0); // leicht über dem Objekt
    labelObject.add(label);

    percLabel = { label, text, spinner, parent: labelObject };
}

// --- Pointer Event ---
function onPointerDown(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(triggers, true);
    if (intersects.length > 0) {
        ramBlinking = true;
    }

    const psu = scene.getObjectByName('PSU000_1');
    if (psu) {
        const psuIntersects = raycaster.intersectObject(psu, true);
        if (psuIntersects.length > 0) {
            onPSUClick(psuIntersects[0].object);
        }
    }
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

function populateDropdown(id, max, step, skipZeroOption = false) {
    const select = document.getElementById(id);
    select.innerHTML = '';
    for (let i = skipZeroOption ? 0 : 1; i <= max; i += step) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = i;
        select.appendChild(opt);
    }
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
            m.emissive = m.color.clone();
            m.emissiveIntensity = 0.6;
        });
    } else {
        material.emissive = material.color.clone();
        material.emissiveIntensity = 0.6;
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

// --- Animate ---
function animate(time) {
    const delta = clock.getDelta();

    if (cameraAnimation) cameraAnimation(delta);

    const t = time * 0.005;
    const pulse = 1.0 + 0.5 * Math.sin(t);

    if (ramBlinking) {
        ramGroups.forEach(group => {
            if (!group) return;
            group.forEach(obj => {
                if (!obj || !obj.material) return;
                if (Array.isArray(obj.material)) {
                    obj.material.forEach(m => {
                        if (m.userData.baseEmissive) {
                            m.emissive.copy(m.userData.baseEmissive);
                            m.emissiveIntensity = pulse;
                        }
                    });
                }else {
    if (obj.material.userData.baseEmissive) {
        obj.material.emissive.copy(obj.material.userData.baseEmissive);
        obj.material.emissiveIntensity = pulse;
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
    if (!percIndex) return;

    const dummyPerc = scene.getObjectByName('PERC');
    if (!dummyPerc) {
        console.warn('Kein Dummy-PERC gefunden!');
        return;
    }

    if (currentPerc) {
        scene.remove(currentPerc);
        currentPerc.traverse(child => {
            if (child.isMesh) {
                child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) child.material.forEach(mat => mat.dispose());
                    else child.material.dispose();
                }
            }
        });
        currentPerc = null;
    }

    dummyPerc.visible = true;

    if (percLabel) {
        percLabel.spinner.style.display = 'block';
        percLabel.text.textContent = `PERC Controller ${percIndex}`;
    }

    const path = `models/glb/perc/`;
    const glbFile = `perc_${percIndex}.glb`;

    const loaderGLB = new GLTFLoader();
    loaderGLB.setPath(path).load(glbFile, gltf => {
        const perc = gltf.scene;
        perc.position.set(.08, .015, -.09);
        perc.rotation.copy(dummyPerc.rotation);
        perc.scale.set(0.025, 0.025, 0.025);

        perc.traverse(child => {
            if (child.isMesh) {
                makeEmissive(child.material);
                enhanceMaterial(child.material);
            }
        });

        dummyPerc.visible = false;

        if (percLabel) percLabel.spinner.style.display = 'none';

        currentPerc = perc;
        scene.add(perc);
    }, undefined, error => {
        console.error('Fehler beim Laden des Perc:', error);
        if (percLabel) percLabel.spinner.style.display = 'none';
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