// This isn't very clean code yet. It's about as redundant as a TPS report report.

// The canvas element that we are going to be rendering to.
var canvas;

// The WebGL context that we will be extracting from the canvas.
var glContext;

// The framebuffer in which the ID pass is rendered.
var idFramebuffer;

// The framebuffer in which the colour pass is rendered.
var colorFramebuffer;

// The framebuffer in which the normal-differentiating pass is rendered.
var normalFramebuffer;

// The framebuffer quad onto which the Sobel filtered pass is drawn onto.
var idFBQuad;

// The shader program used to render the ID pass.
var idPassProgram;

// The shader program used to render the horizontal bit of the Sobel filtering.
var sobelPassProgram;

// The normal-calculating shader program.
var normalPassProgram;

// Whether or not dFdx and dFdy are supported in the fragment shader on the current
// hardware.
var normalSupported = 0;

// The 3D model that is colour coded for Sobel filtering.
var idModel;

// The 3D model that is colour coded to be seen by the user.
var colorModel;

// The array of room information objects.
var rooms;

// The model view matrix that is used to translate and rotate the scenes' geometry.
var mvmat = mat4.create();

// The perspective matrix that quantifies the view frustum.
var pmat = mat4.create();

// Canvas size scale factor.
var canvasScale = .975;

// The near and far clipping plane z-coordinates.
var zNear = 500.0;
var zFar = 3000.0;


function initContext()
{
	// Extract the canvas from the document.
	canvas = document.getElementById("map_canvas");
	
	// Update the initial canvas size to full occupancy.
	// Fuck lil' posers who don't like it big.
	canvas.width = window.innerWidth*canvasScale;
	canvas.height = window.innerHeight*canvasScale;
	
	// Register all our callbacks.
	hudOutline = document.getElementById("hud_outline");
	hudOutline.addEventListener('mousedown', mouseDownFunction, false);
	hudOutline.addEventListener('mouseup', mouseUpFunction, false);
	hudOutline.addEventListener('mousemove', mouseMoveFunction, false);
	canvas.addEventListener('mousedown', mouseDownFunction, false);
	canvas.addEventListener('mouseup', mouseUpFunction, false);
	canvas.addEventListener('mousemove', mouseMoveFunction, false);
	window.addEventListener('keydown', keyDownFunction, false);
	window.addEventListener('keyup', keyUpFunction, false);
	window.addEventListener('mousewheel', scrollWheelFunction, false);
	window.addEventListener('DOMMouseScroll', scrollWheelFunction, false);
	window.onkeypress = keyPressedFunction;
	
	// Register a callback to handle window resizing.
	// You know, so it stays big.
	window.onresize = function(event)
	{
		canvas.width = window.innerWidth*canvasScale;
		canvas.height = window.innerHeight*canvasScale;
	}
	
	// Try to get a WebGL context from it. If we can't, well, poop.
	try{
		glContext = canvas.getContext("experimental-webgl");
	}
	catch(e)
	{
		try{
		}
		catch(e){}
	}
	if(!glContext)
	{
		try{
		}
		catch(e){}
	}
	
	// Set the screen-blanking colour to black.
	glContext.clearColor(0.0, 0.0, 0.0, 1.0);
	
	// Enable depth testing.
	glContext.enable(glContext.DEPTH_TEST);
	
	// Enable derivative extension.
	normalSupported = glContext.getExtension("OES_standard_derivatives");
}

function initShaders()
{
	// Create the shader that will be used to render the original pass onto the
	// framebuffer.
	idPassProgram = createShaderProgram(glContext, "idVert", "idFrag");
	
	// Store the location within the shader of its vertex position entry point.
	idPassProgram.vertPosAttribute = glContext.getAttribLocation(idPassProgram, "vertPos");	
	// Enable the use of this entry point.
	glContext.enableVertexAttribArray(idPassProgram.vertPosAttribute);
	
	// We also store the location of the colour data entry point...
	idPassProgram.vertColorAttribute = glContext.getAttribLocation(idPassProgram, "vertColor");
	// ..and store it as well.
	glContext.enableVertexAttribArray(idPassProgram.vertColorAttribute);
	
	// Store the locations within the shader of the two transformation matrices.
	idPassProgram.pmatUniform = glContext.getUniformLocation(idPassProgram, "pmat");
	idPassProgram.mvmatUniform = glContext.getUniformLocation(idPassProgram, "mvmat");
	
	// If the current hardware supports the derivatives extension, we create the derivative shader.
	if(normalSupported)
	{
		normalPassProgram = createShaderProgram(glContext, "normalVert", "normalFrag");
		normalPassProgram.vertPosAttribute = glContext.getAttribLocation(normalPassProgram, "vertPos");	
		glContext.enableVertexAttribArray(normalPassProgram.vertPosAttribute);
		normalPassProgram.vertColorAttribute = glContext.getAttribLocation(normalPassProgram, "vertColor");
		//glContext.enableVertexAttribArray(normalPassProgram.vertColorAttribute);
		normalPassProgram.pmatUniform = glContext.getUniformLocation(normalPassProgram, "pmat");
		normalPassProgram.mvmatUniform = glContext.getUniformLocation(normalPassProgram, "mvmat");
	}
	
	
	// Create the shader that will be used to render the framebuffers onto the framebuffer quad.
	sobelPassProgram = createShaderProgram(glContext, "sobelVert", "sobelFrag");
	
	// We store and enable the vertex position attribute and entry point for this shader as well.
	sobelPassProgram.vertPosAttribute = glContext.getAttribLocation(sobelPassProgram, "vertPos");
	glContext.enableVertexAttribArray(sobelPassProgram.vertPosAttribute);
	// However with this shader we don't have a vertex colour entry point and attribute; rather,
	// we have an entry point for texture coordinates to be fed in. This allows us to render
	// the framebuffer texture accurately.
	sobelPassProgram.vertUVAttribute = glContext.getAttribLocation(sobelPassProgram, "vertUV");
	glContext.enableVertexAttribArray(sobelPassProgram.vertUVAttribute);
	
	// Store the location of the framebuffer sampler uniform so we can feed the texture data of the
	// framebuffer.
	sobelPassProgram.diffableSampler = glContext.getUniformLocation(sobelPassProgram, "diffableSampler");
	sobelPassProgram.colorSampler = glContext.getUniformLocation(sobelPassProgram, "colorSampler");
	sobelPassProgram.normalSampler = glContext.getUniformLocation(sobelPassProgram, "normalSampler");
	
	// Store the location of the current room ID uniform.
	sobelPassProgram.curIDUniform = glContext.getUniformLocation(sobelPassProgram, "curRoomID");
}

function initFBsAndQuads()
{
	// Create the ID render pass framebuffer with the same dimensions as the canvas.
	idFramebuffer = new WGLFramebuffer(glContext, 1024, 1024);
	colorFramebuffer = new WGLFramebuffer(glContext, 1024, 1024);
	normalFramebuffer = new WGLFramebuffer(glContext, 1024, 1024);
	idFBQuad = new FBRenderQuad(glContext, sobelPassProgram);
}

function setMatrixUniforms(program) 
{
	// Pass the values of the two transformation matrices to the ID Pass shader, so
	// that we can handle model transformations.
	glContext.uniformMatrix4fv(program.pmatUniform, false, pmat);
	glContext.uniformMatrix4fv(program.mvmatUniform, false, mvmat);
}

function initModel()
{
	// Create the 3D model of the floor.
	idModel = new Model3D(glContext, idModelPosData, idModelColorData);
	colorModel = new Model3D(glContext, colorModelPosData, colorModelColorData);
}

function degToRad(degreesX) {
    return degreesX * Math.PI / 180;
}

function performModelTransformations()
{
	// Reset the model view matrix so that we don't stack changes repeatedly.
	mat4.identity(mvmat);	
	
	mat4.rotate(pmat, degToRad(degreesY), [1, 0, 0]);
	mat4.translate(mvmat, [0, 0, camZ]);
	mat4.rotate(mvmat, degToRad(degreesX), [0, 1, 0]);
	mat4.translate(mvmat, [0, 0, -camZ]);
	mat4.translate(mvmat, [xTrans, yTrans, zTrans]);
}

function performCameraTransformations()
{
	mat4.rotate(mvmat, degToRad(30), [1, 0, 0]);
	mat4.rotate(mvmat, degToRad(degreesX), [0, 1, 0]);
}

function renderModel(model, program)
{
	// Now we tell WebGL to use the appropriate shader program.
	//glContext.useProgram(idPassProgram);
	// To render the first pass, first we must tell the WebGL state to render out to the
	// ID framebuffer. This framebuffer is used to draw the final wireframe visuals that the
	// user sees, but also for sampling against the position of the mouse to tell what room
	// the user has clicked on.
	
	// Set up the viewport to take advantage of all the pixels in the framebuffer texture.
	glContext.viewport(0, 0, idFramebuffer.getWidth(), idFramebuffer.getHeight());
	
	// Clear the screen of the previous frame.
	glContext.clear(glContext.COLOR_BUFFER_BIT | glContext.DEPTH_BUFFER_BIT);
	
	mat4.identity(pmat);
	// Apply standard perspective transformations to the perspective matrix..
	mat4.perspective(45, canvas.width/canvas.height, zNear, zFar, pmat);
	
	performModelTransformations();
	
	// Render the floor map model. You know the drill.
	glContext.bindBuffer(glContext.ARRAY_BUFFER, model.getPosBuffer());
	glContext.vertexAttribPointer(idPassProgram.vertPosAttribute, model.getPosBuffer().itemSize, glContext.FLOAT, false, 0, 0);

	glContext.bindBuffer(glContext.ARRAY_BUFFER, model.getColorBuffer());
	glContext.vertexAttribPointer(idPassProgram.vertColorAttribute, model.getColorBuffer().itemSize, glContext.FLOAT, false, 0, 0);

	setMatrixUniforms(program);
	for(var i = 0; i < model.getPosBuffer().items; i+=3)
		glContext.drawArrays(glContext.TRIANGLES, i, 3);
		
	// Stop using the ID pass program...
}

function renderVisPass()
{
	// Clear the previous frame.
	glContext.clear(glContext.COLOR_BUFFER_BIT | glContext.DEPTH_BUFFER_BIT);
	
	// Use the framebuffer quad shader.
	glContext.useProgram(sobelPassProgram);
	
	// Set the viewport to take up all the pixels on the canvas.
	glContext.viewport(0, 0, canvas.width, canvas.height);
	
	
	// Bind to the FBQuad's position buffer and alert the shader program.
	glContext.bindBuffer(glContext.ARRAY_BUFFER, idFBQuad.getPosBuffer());
	glContext.vertexAttribPointer(sobelPassProgram.vertPosAttribute, idFBQuad.getPosBuffer().itemSize, glContext.FLOAT, false, 0, 0);
	
	// Give it too a reference to the UV data.
	glContext.bindBuffer(glContext.ARRAY_BUFFER, idFBQuad.getUVBuffer());
	glContext.vertexAttribPointer(sobelPassProgram.vertUVAttribute, idFBQuad.getUVBuffer().itemSize, glContext.FLOAT, false, 0, 0);
	
	// Activate a texture unit to pass in the ID framebuffer texture.
	glContext.activeTexture(glContext.TEXTURE0);
	// Bind to the ID pass framebuffer's texture.
	glContext.bindTexture(glContext.TEXTURE_2D, idFramebuffer.getTex());
	// Give the sampler uniform the ID of the texture unit that we are using.
	glContext.uniform1i(sobelPassProgram.diffableSampler, 0);
	
	// Activate another texture unit to pass in the differentiated-normal framebuffer texture.
	glContext.activeTexture(glContext.TEXTURE1);
	// Pass in the colour framebuffer's texture data.
	glContext.bindTexture(glContext.TEXTURE_2D, normalFramebuffer.getTex());
	// Tell the shader what's up.
	glContext.uniform1i(sobelPassProgram.normalSampler, 1);
	
	// Activate a third texture unit to pass in the colour framebuffer texture.
	glContext.activeTexture(glContext.TEXTURE2);
	// Pass in the colour framebuffer's texture data.
	glContext.bindTexture(glContext.TEXTURE_2D, colorFramebuffer.getTex());
	// Tell the shader what's up.
	glContext.uniform1i(sobelPassProgram.colorSampler, 2);
	
	// Give the shader the ID of the current room.
	glContext.uniform1i(sobelPassProgram.curIDUniform, curRoom);
	
	// Draw the quad. 
	glContext.drawArrays(glContext.TRIANGLE_STRIP, 0, 4);
	
	// Stop using the framebuffer quad shader.
	glContext.useProgram(null);
}

function renderFrame()
{
	// Call the stupid key pressed function because of how slow keyboard callbacks are.
	keyPressedFunction();
	
	////////////////////////////////////////////////////////////////////////////////////////
	// Start using the ID pass program, which is used to simply render models.
	glContext.useProgram(idPassProgram);
	
	// Select the ID pass framebuffer to be rendered to.
	idFramebuffer.use(glContext);
	// Set the clear colour to yellow so the checking algorithm works.
	glContext.clearColor(1.0, 1.0, 0.0, 1.0); 
	// Render the model.
	renderModel(idModel, idPassProgram);
	// Discontinue use of the ID pass framebuffer.
	idFramebuffer.stopUse(glContext);
	
	glContext.useProgram(null);
	////////////////////////////////////////////////////////////////////////////////////////
	glContext.useProgram(idPassProgram);
	
	// Change over to the user-colours framebuffer.
	colorFramebuffer.use(glContext);
	// Set the clear colour to black. This is what the user sees.
	glContext.clearColor(0.0, 0.0, 0.0, 1.0);
	renderModel(colorModel, idPassProgram);
	// Stop rendering to the user-vis buffer.
	colorFramebuffer.stopUse(glContext);	
	
	// Also stop using the model rendering program.
	glContext.useProgram(null);
	////////////////////////////////////////////////////////////////////////////////////////
	if(normalSupported)
	{
		glContext.useProgram(normalPassProgram);
		
		// Change over to the user-colours framebuffer.
		normalFramebuffer.use(glContext);
		// Set the clear colour to black. This is what the user sees.
		glContext.clearColor(1.0, 1.0, 1.0, 1.0);
		renderModel(colorModel, normalPassProgram);
		// Stop rendering to the user-vis buffer.
		normalFramebuffer.stopUse(glContext);	
		
		// Also stop using the model rendering program.
		glContext.useProgram(null);
	}
	////////////////////////////////////////////////////////////////////////////////////////
	// Use the Sobel/wire-frame shader to render the 
	//framebuffers onto a quad, and that quad onto the screen.
	glContext.useProgram(sobelPassProgram);
	renderVisPass();
	glContext.useProgram(null);
}

function initWebGLComponents()
{
	// Call the initialization function of all the things!
	initContext();
	initShaders();
	initFBsAndQuads();
	initModel();
	rooms = loadRooms("rooms.xml");
	// Register a timed interval to draw a new frame every 1/60th of a second.
	// Janky, but it works.
	window.setInterval(renderFrame, 1000/60);	
}
	
