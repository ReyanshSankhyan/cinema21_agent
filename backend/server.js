const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { ElevenLabsClient } = require("@elevenlabs/elevenlabs-js");
const axios = require("axios");
const { createClient } = require("@supabase/supabase-js");
const FormData = require('form-data');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use("/static", express.static(path.join(__dirname, "../dist")));

const AGENT_ID_PATH = path.join(__dirname, "agent_id.json");
const VOICE_ID_PATH = path.join(__dirname, "voice_id.json");
const TOOL_IDS_PATH = path.join(__dirname, "tool_ids.json");
let agentId = null;
let voiceId = null;
let toolIds = { write: null, read: null, whatsapp_order_confirmation: null };

const upload = multer({ dest: "uploads/" });

const client = new ElevenLabsClient({ apiKey: process.env.XI_API_KEY });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY);

// In-memory chat log for demo (replace with persistent storage for production)
let chatLog = [];

const EXPRESSIVE_VOICE_SETTINGS = {
  stability: 0.3,
  similarity_boost: 0.8,
  speed: 1.0,
};

const DEFAULT_VOICE_ID = '0DMnTGNUsMTspwY1brDA';
const BASE_API_URL = 'http://localhost:3000';

async function fetchKnowledgeData() {
  const kbFilePath = path.join(__dirname, "knowledge_base.txt");
  let staticInfo = fs.readFileSync(kbFilePath, "utf-8");
  let cinemaData = null;
  let foodData = null;
  
  try {
    const respCinema = await axios.get(`${BASE_API_URL}/cinema/JKTGAND`);
    // Extract movie codes from image URLs and add them to each movie
    const moviesWithCodes = respCinema.data.map(movie => {
      const imageUrl = movie.image_url || movie.imageUrl;
      const code = imageUrl ? imageUrl.split('/').pop().replace('.jpg', '') : null;
      return {
        ...movie,
        code: code
      };
    });
    cinemaData = JSON.stringify(moviesWithCodes, null, 2);
  } catch (err) {
    console.error("Failed to fetch cinema data from API:", err.message || err);
    cinemaData = "(Failed to fetch cinema data from API)";
  }
  
  try {
    const respFood = await axios.get(`${BASE_API_URL}/get-food/NSR021-1201`);
    // Remove descriptions from food items before adding to agent prompt
    const foodItemsWithoutDescriptions = respFood.data.map(item => ({
      name: item.name,
      price: item.price,
      imageUrl: item.imageUrl
    }));
    foodData = JSON.stringify(foodItemsWithoutDescriptions, null, 2);
  } catch (err) {
    console.error("Failed to fetch food data from API:", err.message || err);
    foodData = "(Failed to fetch food data from API)";
  }
  
  return `${staticInfo}\n\n--- Cinema JKTGAND Data (JSON) ---\n${cinemaData}\n\n--- Food Data (JSON) ---\n${foodData}\n`;
}

async function createToolsIfNeeded() {
  // If tool_ids.json exists and contains all required tool IDs, do not create tools
  if (fs.existsSync(TOOL_IDS_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(TOOL_IDS_PATH, 'utf-8'));
      if (
        data.show_cinemas_showtimes &&
        data.show_food_items &&
        data.update_cart &&
        data.place_order &&
        data.play_movie_trailer &&
        data.set_movie_selection
      ) {
        toolIds = { ...data };
        console.log('Loaded all tools with IDs:', toolIds);
        return toolIds;
      }
    } catch (e) {
      // If error reading/parsing, fall through to create tools
    }
  }
  const toolsList = await client.conversationalAi.tools.list();
  
  // WhatsApp Order Confirmation tool (webhook) - FIRST TOOL
  let whatsappOrderConfirmationTool = toolsList.tools.find(t => t.tool_config?.name === "whatsapp_order_confirmation");
  let whatsappOrderConfirmationToolId = whatsappOrderConfirmationTool ? whatsappOrderConfirmationTool.id : null;
  if (!whatsappOrderConfirmationTool) {
    const resp = await axios.post('https://api.elevenlabs.io/v1/convai/tools', {
            tool_config: {
        name: "whatsapp_order_confirmation",
        description: "Send order confirmation message to user via WhatsApp. This tool should be called immediately after placing an order to send a confirmation message with movie details, showtime, and cart contents.",
        type: "webhook",
        api_schema: {
          url: "https://workflows.cekat.ai/webhook/xxi",
          method: "POST",
          request_body_schema: {
            type: "object",
            required: ["receiverPhoneNumber", "movieName", "movieShowtime", "cartItems"],
            properties: {
              receiverPhoneNumber: {
                type: "string",
                description: "The phone number to send the WhatsApp message to (e.g., +6281234567890)"
              },
              movieName: {
                type: "string",
                description: "The name of the movie being booked"
              },
              movieShowtime: {
                type: "string",
                description: "The showtime for the movie (e.g., '19:30' or '7:30 PM')"
              },
              cartItems: {
                type: "string",
                description: "A comma-separated list of food items in the cart (e.g., 'Popcorn, Coke, Nachos') or 'No food items' if cart is empty"
              }
            }
          },
          request_headers: {
            "Content-Type": "application/json"
          }
        }
      }
    }, { headers: { "xi-api-key": process.env.XI_API_KEY } });
    whatsappOrderConfirmationToolId = resp.data.id;
    console.log("Created tool: whatsapp_order_confirmation with ID:", whatsappOrderConfirmationToolId);
  } else {
    console.log("Loaded tool: whatsapp_order_confirmation with ID:", whatsappOrderConfirmationToolId);
  }
  
  // Show Cinemas Showtimes tool (client) - for a single cinema only
  let showCinemasShowtimesTool = toolsList.tools.find(t => t.tool_config?.name === "show_cinemas_showtimes");
  let showCinemasShowtimesToolId = showCinemasShowtimesTool ? showCinemasShowtimesTool.id : null;
  if (!showCinemasShowtimesTool) {
    const resp = await axios.post('https://api.elevenlabs.io/v1/convai/tools', {
      tool_config: {
        name: "show_cinemas_showtimes",
        description: "Display the showtimes for multiple movies at a single cinema in the frontend UI. Each movie can have multiple showtimes and an image URL.",
        type: "client",
        response_timeout_secs: 20,
        parameters: {
          type: "object",
          required: ["cinema_name", "movies"],
          properties: {
            cinema_name: { type: "string", description: "The name of the cinema (should always be JKTGAND)" },
            movies: {
              type: "array",
              description: "Array of movies with their showtimes and image URLs",
              items: {
                type: "object",
                required: ["movie_name", "showtimes"],
                properties: {
                  movie_name: { type: "string", description: "The name of the movie" },
                  image_url: { type: "string", description: "URL of the movie poster image" },
                  showtimes: {
                    type: "array",
                    description: "Showtimes for this movie",
                    items: { type: "string", description: "A showtime for this movie" }
                  }
                }
              }
            }
          },
          description: "Parameters for displaying showtimes for multiple movies at a single cinema."
        }
      }
    }, { headers: { "xi-api-key": process.env.XI_API_KEY } });
    showCinemasShowtimesToolId = resp.data.id;
    console.log("Created tool: show_cinemas_showtimes with ID:", showCinemasShowtimesToolId);
  } else {
    console.log("Loaded tool: show_cinemas_showtimes with ID:", showCinemasShowtimesToolId);
  }
  // Show Food Items tool (client)
  let showFoodItemsTool = toolsList.tools.find(t => t.tool_config?.name === "show_food_items");
  let showFoodItemsToolId = showFoodItemsTool ? showFoodItemsTool.id : null;
  if (!showFoodItemsTool) {
    const resp = await axios.post('https://api.elevenlabs.io/v1/convai/tools', {
      tool_config: {
        name: "show_food_items",
        description: "Display up to 10 food items in the frontend UI. Each food item has a name, an optional description, a price, and an image URL. Never show more than 10 food items at a time.",
        type: "client",
        response_timeout_secs: 20,
        parameters: {
          type: "object",
          required: ["food_items"],
          properties: {
            food_items: {
              type: "array",
              description: "List of food items to display (max 10)",
              items: {
                type: "object",
                required: ["name", "price"],
                properties: {
                  name: { type: "string", description: "Food item name" },
                  price: { type: "number", description: "Price of the food item" },
                  image_url: { type: "string", description: "URL of the food item image" }
                }
              }
            }
          },
          description: "Parameters for displaying food items."
        }
      }
    }, { headers: { "xi-api-key": process.env.XI_API_KEY } });
    showFoodItemsToolId = resp.data.id;
    console.log("Created tool: show_food_items with ID:", showFoodItemsToolId);
  } else {
    console.log("Loaded tool: show_food_items with ID:", showFoodItemsToolId);
  }
  // Update Cart tool (client)
  let updateCartTool = toolsList.tools.find(t => t.tool_config?.name === "update_cart");
  let updateCartToolId = updateCartTool ? updateCartTool.id : null;
  if (!updateCartTool) {
    const resp = await axios.post('https://api.elevenlabs.io/v1/convai/tools', {
      tool_config: {
        name: "update_cart",
        description: "Update and display the user's cart. Each item has a name, quantity, and price. Never show more than 20 items at a time. If an item is added more than once, increase its quantity instead of duplicating it.",
        type: "client",
        response_timeout_secs: 20,
        parameters: {
          type: "object",
          required: ["cart_items"],
          properties: {
            cart_items: {
              type: "array",
              description: "List of cart items (max 20)",
              items: {
                type: "object",
                required: ["name", "quantity", "price"],
                properties: {
                  name: { type: "string", description: "Cart item name" },
                  quantity: { type: "integer", description: "Quantity of this item in the cart" },
                  price: { type: "number", description: "Price of a single item" }
                }
              }
            }
          },
          description: "Parameters for updating the cart."
        }
      }
    }, { headers: { "xi-api-key": process.env.XI_API_KEY } });
    updateCartToolId = resp.data.id;
    console.log("Created tool: update_cart with ID:", updateCartToolId);
  } else {
    console.log("Loaded tool: update_cart with ID:", updateCartToolId);
  }
  // Place Order tool (client)
  let placeOrderTool = toolsList.tools.find(t => t.tool_config?.name === "place_order");
  let placeOrderToolId = placeOrderTool ? placeOrderTool.id : null;
  if (!placeOrderTool) {
    const resp = await axios.post('https://api.elevenlabs.io/v1/convai/tools', {
      tool_config: {
        name: "place_order",
        description: "Place an order for movie tickets and food items. This tool should only be used when the user has confirmed their order. It displays order confirmation with movie details, showtime, cart contents, and pickup information. The frontend already has the movie, showtime, and cart data.",
        type: "client",
        response_timeout_secs: 20,
        parameters: {
          type: "object",
          required: [],
          properties: {},
          description: "No parameters needed - frontend has all required data."
        }
      }
    }, { headers: { "xi-api-key": process.env.XI_API_KEY } });
    placeOrderToolId = resp.data.id;
    console.log("Created tool: place_order with ID:", placeOrderToolId);
  } else {
    console.log("Loaded tool: place_order with ID:", placeOrderToolId);
  }
  

  // Play Movie Trailer tool (client)
  let playMovieTrailerTool = toolsList.tools.find(t => t.tool_config?.name === "play_movie_trailer");
  let playMovieTrailerToolId = playMovieTrailerTool ? playMovieTrailerTool.id : null;
  if (!playMovieTrailerTool) {
    const resp = await axios.post('https://api.elevenlabs.io/v1/convai/tools', {
      tool_config: {
        name: "play_movie_trailer",
        description: "Play a movie trailer on screen. The agent should provide the movie code (extracted from the movie's image URL) to play the corresponding trailer video.",
        type: "client",
        response_timeout_secs: 20,
        parameters: {
          type: "object",
          required: ["movie_code"],
          properties: {
            movie_code: { type: "string", description: "The movie code extracted from the movie's image URL (e.g., '25BDU2' from 'https://nos.jkt-1.neo.id/media.cinema21.co.id/movie-images/25BDU2.jpg')" }
          },
          description: "Parameters for playing a movie trailer."
        }
      }
    }, { headers: { "xi-api-key": process.env.XI_API_KEY } });
    playMovieTrailerToolId = resp.data.id;
    console.log("Created tool: play_movie_trailer with ID:", playMovieTrailerToolId);
  } else {
    console.log("Loaded tool: play_movie_trailer with ID:", playMovieTrailerToolId);
  }
  // Set Movie Selection tool (client)
  let setMovieSelectionTool = toolsList.tools.find(t => t.tool_config?.name === "set_movie_selection");
  let setMovieSelectionToolId = setMovieSelectionTool ? setMovieSelectionTool.id : null;
  if (!setMovieSelectionTool) {
    const resp = await axios.post('https://api.elevenlabs.io/v1/convai/tools', {
      tool_config: {
        name: "set_movie_selection",
        description: "Set the selected movie and showtime for booking. This displays the movie and showtime information in the top section of the cart panel.",
        type: "client",
        response_timeout_secs: 20,
        parameters: {
          type: "object",
          required: ["movie_name", "showtime"],
          properties: {
            movie_name: { type: "string", description: "The name of the movie being booked" },
            showtime: { type: "string", description: "The showtime for the movie" }
          },
          description: "Parameters for setting the movie selection."
        }
      }
    }, { headers: { "xi-api-key": process.env.XI_API_KEY } });
    setMovieSelectionToolId = resp.data.id;
    console.log("Created tool: set_movie_selection with ID:", setMovieSelectionToolId);
  } else {
    console.log("Loaded tool: set_movie_selection with ID:", setMovieSelectionToolId);
  }
  saveToolIds({ show_cinemas_showtimes: showCinemasShowtimesToolId, show_food_items: showFoodItemsToolId, update_cart: updateCartToolId, place_order: placeOrderToolId, whatsapp_order_confirmation: whatsappOrderConfirmationToolId, play_movie_trailer: playMovieTrailerToolId, set_movie_selection: setMovieSelectionToolId });
  return { show_cinemas_showtimes: showCinemasShowtimesToolId, show_food_items: showFoodItemsToolId, update_cart: updateCartToolId, place_order: placeOrderToolId, whatsapp_order_confirmation: whatsappOrderConfirmationToolId, play_movie_trailer: playMovieTrailerToolId, set_movie_selection: setMovieSelectionToolId };
}



async function createAgentWithAll(toolIds) {
  // Fetch knowledge data to include in system prompt
  const knowledgeData = await fetchKnowledgeData();
  
  const config = {
    agent: {
      firstMessage: "Hi, how can I help you?",
      prompt: {
        prompt: `# Personality

You are Agus, a helpful, polite, and efficient voice customer service agent for Cinema XXI at Gandaria City (JKTGAND). You assist customers with movie bookings, food orders, and cinema information. You are concise, direct, and focused on completing tasks efficiently.

# Environment

You are engaged in a voice conversation with customers who want to book movie tickets and order food at Cinema XXI Gandaria City. The user can see visual information displayed on screen through your tools. Always assume the cinema is Gandaria City and do not ask the user to specify a cinema.

# Tone

- Be concise and direct - only do what the user asks
- Do not offer additional help or ask if there's anything else
- Use clear, simple language optimized for voice synthesis
- Avoid unnecessary conversation or pleasantries
- Focus on the specific task requested

# Goal

Your primary goal is to help customers complete their movie booking and food orders efficiently. This involves:

1. **Movie Selection**: Help users choose movies and showtimes
2. **Food Ordering**: Assist with food menu selection and cart management  
3. **Order Completion**: Guide users through the booking process
4. **Information Display**: Show relevant information visually on screen

# Guardrails

- **Cart Restrictions**: The cart is ONLY for food items from the menu. NEVER add movies or tickets to the cart
- **Movie/Showtime Tracking**: Use set_movie_selection tool to track the selected movie and showtime separately from the cart
- **Tool Usage**: Always use tools to display information visually instead of just describing it
- **Confirmation**: Only confirm orders BEFORE placing them, not after
- **Silence After Trailers**: Stay completely silent after playing trailers until user speaks
- **No Unnecessary Help**: Do not offer additional assistance unless specifically asked

# Tools

You have access to these tools:

1. **show_cinemas_showtimes** - Display movie showtimes for Gandaria City Cinema. Each movie includes an image_url and code field for trailer access.

2. **show_food_items** - Display food menu items available at the cinema.

3. **set_movie_selection** - Set the selected movie and showtime for booking. Use this when user chooses a movie and showtime.

4. **update_cart** - Update the user's cart with food items ONLY. The cart is strictly for food from the menu.

5. **place_order** - Place the final order. No parameters needed - frontend has movie, showtime, and cart data.

6. **whatsapp_order_confirmation** - Send order confirmation message to user via WhatsApp. This tool should be called IMMEDIATELY after placing an order. You need to provide: receiverPhoneNumber (ask user for their phone number), movieName (from the selected movie), movieShowtime (from the selected showtime), and cartItems (comma-separated list of food items or 'No food items' if empty).

7. **play_movie_trailer** - Play a movie trailer using the movie's code. After playing, use skip_turn and stay silent until user speaks.

# Knowledge Base

CINEMA XXI KNOWLEDGE BASE:
${knowledgeData}

# Workflow Guidelines

**Movie Booking Process:**
1. User selects movie/showtime → Use set_movie_selection tool
2. User adds food items → Use update_cart tool (food only)
3. User confirms order → Use place_order tool
4. IMMEDIATELY after place_order → Use whatsapp_order_confirmation tool with user's phone number, movie details, and cart items

**Cart Management:**
- Cart is ONLY for food items from the menu
- Never add movies or tickets to cart
- Always include all existing cart items when updating
- Use update_cart tool for every cart change

**Order Confirmation:**
- Confirm order BEFORE placing: "Let me confirm your order. It's [movie] at [showtime] with [food items or 'no food']. Should I place this order?"
- Only place order after user confirms
- IMMEDIATELY after placing order, call whatsapp_order_confirmation tool to send confirmation message. Ask user for their phone number and provide movie details and cart items.
- No post-order confirmations

**Trailer Playback:**
- Use movie code from cinema data
- After playing trailer, use skip_turn tool
- Stay completely silent until user speaks again

Answer questions using the knowledge base information above. Be concise and direct. Only do what the user asks - focus on the specific task requested.`,
        builtInTools: {
            languageDetection: {
              name: "language_detection",
              description: "",
              params: {
                systemToolType: "language_detection"
              }
            },
            skipTurn: {
                name: "skip_turn",
                description: "",
                params: {
                  systemToolType: "skip_turn"
                }
              }
          },
        toolIds: [toolIds.show_cinemas_showtimes, toolIds.show_food_items, toolIds.update_cart, toolIds.place_order, toolIds.whatsapp_order_confirmation, toolIds.play_movie_trailer, toolIds.set_movie_selection].filter(Boolean),
        llm: "gemini-2.0-flash"
      }
    },
    tts: {
      voiceId: voiceId,
      stability: EXPRESSIVE_VOICE_SETTINGS.stability,
      similarityBoost: EXPRESSIVE_VOICE_SETTINGS.similarity_boost,
      speed: EXPRESSIVE_VOICE_SETTINGS.speed
    },
    turn: {
      turnTimeout: 7
    },
    conversation: {
        clientEvents: ["audio", "interruption"]
    },
    languagePresets: {
    "en": {
        overrides: {
          agent: {
            firstMessage: "Hi, how can I help you?",
            language: "en"
          }
        }
      },
      "id": {
        overrides: {
          agent: {
            firstMessage: "Hai, ada yang bisa saya bantu?",
            language: "id"
          }
        }
      }
    }
  };
  try {
    const response = await client.conversationalAi.agents.create({
      conversationConfig: config
    });
    agentId = response.agentId || response.agent_id;
    fs.writeFileSync(AGENT_ID_PATH, JSON.stringify({ agent_id: agentId }));
    console.log("Created agent with ID:", agentId);
  } catch (err) {
    console.error("[CREATE] Error creating agent:", err.response?.data || err.message || err);
    throw err;
  }
}

function loadAgentId() {
  if (fs.existsSync(AGENT_ID_PATH)) {
    const data = JSON.parse(fs.readFileSync(AGENT_ID_PATH, "utf-8"));
    if (data.agent_id) {
    agentId = data.agent_id;
      console.log("Loaded agent with ID:", agentId);
    }
  }
}

async function deleteAgent() {
  if (!agentId) return;
  const response = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
    method: "DELETE",
        headers: {
          "xi-api-key": process.env.XI_API_KEY,
    },
  });
  if (!response.ok) {
    const errorText = await response.text();
    console.error("Failed to delete agent:", errorText);
    throw new Error("Failed to delete agent");
  }
  agentId = null;
  if (fs.existsSync(AGENT_ID_PATH)) fs.unlinkSync(AGENT_ID_PATH);
  console.log("Deleted agent and removed all json files.");
}

function loadVoiceId() {
  if (fs.existsSync(VOICE_ID_PATH)) {
    const data = JSON.parse(fs.readFileSync(VOICE_ID_PATH, "utf-8"));
    voiceId = data.voice_id;
    if (voiceId) {
      console.log("Loaded voice with ID:", voiceId);
    }
  } else {
    voiceId = DEFAULT_VOICE_ID;
    console.log("Using hardcoded default voice ID:", voiceId);
  }
}

async function createVoice(name, filePath) {
  try {
    const result = await client.voices.ivc.create({
      files: [fs.createReadStream(filePath)],
      name,
      remove_background_noise: true,
    });
    voiceId = result.voiceId;
    fs.writeFileSync(VOICE_ID_PATH, JSON.stringify({ voice_id: voiceId }));
    console.log("Created voice with ID:", voiceId);
    return voiceId;
  } catch (error) {
    console.error("Failed to create voice via SDK:", error.response?.data || error.message || error);
    throw new Error("Failed to create voice: " + (error.response?.data?.detail || error.message || error));
  }
}

async function deleteVoice() {
  if (!voiceId || voiceId === DEFAULT_VOICE_ID) return;
  try {
    await client.voices.delete(voiceId);
    console.log("Deleted custom voice:", voiceId);
  } catch (err) {
    console.error("Failed to delete custom voice:", voiceId, err);
  }
  voiceId = null;
  if (fs.existsSync(VOICE_ID_PATH)) fs.unlinkSync(VOICE_ID_PATH);
}

// Only update agent for voice changes
async function updateAgentWithVoice() {
  if (!agentId || !voiceId) return;
  const agent = await client.conversationalAi.agents.get(agentId);
  const config = agent.conversation_config;
  // Set tts at the root, not under agent.prompt
  config.tts = {
    voiceId: voiceId,
    stability: EXPRESSIVE_VOICE_SETTINGS.stability,
    similarityBoost: EXPRESSIVE_VOICE_SETTINGS.similarity_boost,
    speed: EXPRESSIVE_VOICE_SETTINGS.speed
  };
  try {
    await client.conversationalAi.agents.update(agentId, { conversationConfig: config });
    console.log("Updated agent with new voice ID:", voiceId);
  } catch (err) {
    console.error("Failed to update agent with new voice:", err);
  }
}

function loadToolIds() {
  if (fs.existsSync(TOOL_IDS_PATH)) {
    const data = JSON.parse(fs.readFileSync(TOOL_IDS_PATH, "utf-8"));
    if (data.show_cinemas_showtimes && data.show_food_items && data.update_cart && data.place_order && data.whatsapp_order_confirmation) {
    toolIds = { ...toolIds, ...data };
    console.log('Loaded all tools with IDs:', toolIds);
    return true;
    }
  }
  return false;
}

function saveToolIds(ids) {
  // Keep all tools: show_cinemas_showtimes, show_food_items, update_cart, place_order, and whatsapp_order_confirmation
  if (ids.show_cinemas_showtimes && ids.show_food_items && ids.update_cart && ids.place_order && ids.whatsapp_order_confirmation) {
    toolIds = { show_cinemas_showtimes: ids.show_cinemas_showtimes, show_food_items: ids.show_food_items, update_cart: ids.update_cart, place_order: ids.place_order, whatsapp_order_confirmation: ids.whatsapp_order_confirmation };
    fs.writeFileSync(TOOL_IDS_PATH, JSON.stringify(toolIds));
  }
}



// On startup, ensure tools and agent exist in correct order
(async () => {
  loadVoiceId();
  loadAgentId();
  let toolsLoaded = loadToolIds();
  if (!toolsLoaded) {
    toolIds = await createToolsIfNeeded();
  }
  if (!agentId) {
    await createAgentWithAll(toolIds);
  }
})();

app.get("/api/agent", (req, res) => {
  res.json({ agentId: agentId || null });
});

app.delete("/api/agent", async (req, res) => {
  try {
    await deleteAgent();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/signed-url", async (req, res) => {
  try {
    if (!agentId) {
      return res.status(500).json({ error: "Agent not initialized yet" });
    }
    // Use the ElevenLabs SDK to get the signed URL and conversationId
    const result = await client.conversationalAi.conversations.getSignedUrl({ agentId });
    res.json({ signedUrl: result.signedUrl, conversationId: result.conversationId });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to get signed URL" });
  }
});

//API route for getting Agent ID, used for public agents
app.get("/api/getAgentId", (req, res) => {
  const agentId = process.env.AGENT_ID;
  res.json({
    agentId: `${agentId}`,
  });
});

app.get("/api/voice", (req, res) => {
  res.json({ voiceId: voiceId || null });
});

app.post("/api/voice", upload.single("audio"), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !req.file) {
      return res.status(400).json({ error: "Name and audio file are required" });
    }
    console.log("Uploading file:", req.file.originalname, req.file.mimetype, req.file.size, "bytes");
    // If a custom voice already exists, delete it first
    if (voiceId) {
      await deleteVoice();
    }
    let newVoiceId;
    try {
      newVoiceId = await createVoice(name, req.file.path);
    } finally {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }
    // Always update the agent to use the latest voice
    if (agentId) {
      await updateAgentWithVoice();
    } else {
      // This case should ideally not happen if createAgentWithAll is called on startup
      // but as a fallback, we can create a new agent with default tools/knowledge base
      // This requires a way to get default toolIds and knowledgeBaseId if they were not loaded
      // For now, we'll just log a warning and potentially create a new agent with default values
      console.warn("Agent not initialized, creating a new one with default tools/knowledge base.");
      const defaultToolIds = { display_movie_info: null, show_cinemas_showtimes: null, show_food_items: null, update_cart: null };
      const defaultKnowledgeBaseId = null; // No default knowledge base for now
      await createAgentWithAll(defaultToolIds, defaultKnowledgeBaseId);
    }
    res.json({ voiceId: newVoiceId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/voice", async (req, res) => {
  try {
    await deleteVoice();
    if (agentId) {
      await deleteAgent();
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/conversation-summary", async (req, res) => {
  const POLL_INTERVAL_MS = 3000;
  const MAX_WAIT_MS = 30000;
  const startTime = Date.now();
  let lastError = null;
  while (Date.now() - startTime < MAX_WAIT_MS) {
    try {
      const listData = await client.conversationalAi.conversations.list({ agent_id: agentId, pageSize: 3 });
      if (listData.conversations && listData.conversations.length > 0) {
        const convoObj = listData.conversations[0];
        const conversationId = convoObj.conversationId;
        const status = convoObj.status;
        if (!conversationId || conversationId === 'undefined') {
          lastError = 'Latest conversationId is undefined';
          throw new Error(lastError);
        }
        if (status !== 'done') {
          lastError = `Conversation ${conversationId} not done yet (status: ${status}), waiting...`;
          await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
          continue;
        }
        try {
          const convo = await client.conversationalAi.conversations.get(conversationId);
          const transcriptSummary = convo.analysis && convo.analysis.transcriptSummary ? convo.analysis.transcriptSummary : null;
          if (convo.analysis && convo.analysis.summary) {
            return res.json({ summary: convo.analysis.summary, transcript: convo.transcript, transcriptSummary });
          } else if (convo.transcript) {
            return res.json({ transcript: convo.transcript, transcriptSummary });
          } else {
            return res.json({ summary: null, transcript: null, transcriptSummary });
          }
        } catch (err) {
          lastError = err.message || err;
          return res.status(500).json({ error: lastError });
        }
      } else {
        lastError = 'No conversations found for agent';
        throw new Error(lastError);
      }
    } catch (err) {
      lastError = err.message || err;
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
  return res.status(500).json({ error: lastError || 'Timeout waiting for conversation to complete.' });
});

// Serve index.html for all other routes
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../dist/index.html"));
});

// Add this after other endpoints
app.delete('/api/delete-all', async (req, res) => {
  try {
    // Delete agent first
    await deleteAgent();
    // Delete voice
    await deleteVoice();
    // Delete tools (rag, write, read)
    loadToolIds();
    const toolIdList = Object.values(toolIds).filter(Boolean);
    for (const toolId of toolIdList) {
      try {
        await client.conversationalAi.tools.delete(toolId);
      } catch (err) {
        console.error('Failed to delete tool', toolId, err.message || err);
      }
    }
    // Remove tool/voice/agent id files
    [AGENT_ID_PATH, VOICE_ID_PATH, TOOL_IDS_PATH].forEach((file) => {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    });
    // Reset in-memory IDs
    agentId = null;
    voiceId = null;
    toolIds = { write: null, read: null, whatsapp_order_confirmation: null };
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}: http://localhost:${PORT}`);
});
