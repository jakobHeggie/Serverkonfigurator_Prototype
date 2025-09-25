import * as THREE from 'three';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let camera, scene, renderer;
let harddiskObjects = [];
let ramObjects = [];
let trayObjects = [];

init();

function init() {
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 20);
    camera.position.set(1, 1, 1);
    camera.lookAt(0, 0, 0);

    scene = new THREE.Scene();

    // Hemispheric Light
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 4);
    scene.add(hemiLight);
  
	scene.background = new THREE.Color(0xaaaaaa);

    // Ambient Light
    const ambientLight = new THREE.AmbientLight(0xffffff, 2.5); // Slightly decreased intensity
    scene.add(ambientLight);

    // Directional Light with shadows
    const dirLight = new THREE.DirectionalLight(0xffffff, 4); // Increased intensity
    dirLight.position.set(5, 10, 7.5);
    dirLight.castShadow = true;
    dirLight.shadow.camera.top = 2;
    dirLight.shadow.camera.bottom = -2;
    dirLight.shadow.camera.left = -2;
    dirLight.shadow.camera.right = 2;
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 40;
    scene.add(dirLight);

    // Create a checkerboard ground
    //createCheckerboardGround(2, 20);

    const onProgress = function (xhr) {
        if (xhr.lengthComputable) {
            const percentComplete = xhr.loaded / xhr.total * 100;
            //console.log(percentComplete.toFixed(2) + '% downloaded');
        }
    };

    // Load server model
    new MTLLoader()
        .setPath('models/obj/server/')
        .load('server.mtl', function (materials) {
            materials.preload();
            adjustMaterials(materials);

            new OBJLoader()
                .setMaterials(materials)
                .setPath('models/obj/server/')
                .load('server.obj', function (object) {
                    object.scale.setScalar(0.01);

                    // Find and store RAM modules
                    object.traverse((child) => {
                        if (child.isMesh && child.name.startsWith('RAM.')) {
                            ramObjects[parseInt(child.name.split('.')[1])] = child;
                            child.visible = false; // Initially set all RAM modules to invisible
                            child.castShadow = true;
                            child.receiveShadow = true;
                        }
                        // Find and store Trays
                        if (child.isMesh && child.name.startsWith('Tray.')) {
                            trayObjects[parseInt(child.name.split('.')[1])] = child;
                            child.visible = false; // Initially set all trays to invisible
                            child.castShadow = true;
                            child.receiveShadow = true;
                        }
                    });

                    scene.add(object);
                }, onProgress);
        });

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.setAnimationLoop(animate);
    document.body.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.minDistance = 0.4;
    controls.maxDistance = 1;
    controls.enablePan = false;
    controls.minPolarAngle = Math.PI / 4;
    controls.maxPolarAngle = Math.PI / 2.5;
    controls.update();
    controls.saveState();
    controls.reset();

    window.addEventListener('resize', onWindowResize);

    // Populate the RAM selection dropdown
    const ramCountSelect = document.getElementById('ramCount');
    for (let i = 0; i <= 24; i += 2) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = i;
        ramCountSelect.appendChild(option);
    }

    // Populate the Tray selection dropdown
    const trayCountSelect = document.getElementById('trayCount');
    for (let i = 0; i <= 10; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = i;
        trayCountSelect.appendChild(option);
    }

    document.getElementById('ramCount').addEventListener('change', function (event) {
        const count = parseInt(event.target.value);
        updateRamVisibility(count);
    });

    document.getElementById('trayCount').addEventListener('change', function (event) {
        const count = parseInt(event.target.value);
        updateTrayVisibility(count);
    });
}

function createCheckerboardGround(size, divisions) {
    const color1 = new THREE.Color(0x000000); // Schwarz
    const color2 = new THREE.Color(0x888888); // Grau
    const tileSize = size / divisions;

    const geometry = new THREE.PlaneGeometry(tileSize, tileSize);
    geometry.rotateX(-Math.PI / 2);

    for (let i = 0; i < divisions; i++) {
        for (let j = 0; j < divisions; j++) {
            const material = new THREE.MeshBasicMaterial({ color: (i + j) % 2 === 0 ? color1 : color2 });
            const tile = new THREE.Mesh(geometry, material);
            tile.position.set((i - divisions / 2) * tileSize, 0, (j - divisions / 2) * tileSize);
            tile.castShadow = true;
            tile.receiveShadow = true;
            scene.add(tile);
        }
    }
}

function adjustMaterials(materials) {
    for (const material of Object.values(materials.materials)) {
        material.specular.set(0x333333); // Increase specular for more contrast
        material.shininess = 30; // Increase shininess for more highlight
    }
}

function updateHarddiskVisibility(count) {
    harddiskObjects.forEach((object, index) => {
        object.visible = index < count;
    });
}

function updateRamVisibility(count) {
    ramObjects.forEach((object, index) => {
        if (object) {
            object.visible = index < count;
        }
    });
}

function updateTrayVisibility(count) {
    trayObjects.forEach((object, index) => {
        if (object) {
            object.visible = index < count;
        }
    });
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    renderer.render(scene, camera);
}