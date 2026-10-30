export const catalogCategories = [
  { category_id: "pizza", category_name: "Pizza", description: null, display_order: 10, is_active: true },
  { category_id: "fries", category_name: "Fries", description: null, display_order: 20, is_active: true },
  { category_id: "pasta", category_name: "Pasta", description: null, display_order: 30, is_active: true },
  { category_id: "burgers", category_name: "Burgers", description: null, display_order: 40, is_active: true },
  { category_id: "noodles", category_name: "Noodles", description: null, display_order: 50, is_active: true },
  { category_id: "wings", category_name: "Wings", description: null, display_order: 60, is_active: true }
];

const pizzaDescription = "A deliciously creamy and cheesy pizza topped with juicy, flavorful chicken tikka, special creamy sauce, and a generous layer of melted cheese, baked to golden perfection.";
const plainFriesDescription = "Crispy golden fries, freshly prepared and lightly seasoned\u2014crunchy on the outside, soft and fluffy on the inside.";
const kutsuFriesDescription = "Crispy golden fries loaded with creamy cheese, savory pizza toppings, and delicious sauces, baked to perfection for an irresistible cheesy, loaded treat.";

export const catalogItems = [
  { item_id: "creamy-cheesy-tikka-pizza", category_id: "pizza", category_name: "Pizza", item_name: "Creamy Cheesy Tikka Pizza", description: pizzaDescription, base_price: "350.00", availability_status: true, image_url: "/images/creamy-cheesy-tikka-pizza.jpg", sizes: [{ id: "small", name: "Small", price: "350.00" }, { id: "medium", name: "Medium", price: "500.00" }, { id: "large", name: "Large", price: "700.00" }], addons_config: [] },
  { item_id: "plain-fries", category_id: "fries", category_name: "Fries", item_name: "Plain Fries", description: plainFriesDescription, base_price: "200.00", availability_status: true, image_url: "/images/plain-fries.jpg", sizes: [{ id: "small", name: "Small", price: "200.00" }, { id: "large", name: "Large", price: "300.00" }], addons_config: [] },
  { item_id: "kutsu-pizza-fries", category_id: "fries", category_name: "Fries", item_name: "Kutsu Pizza Fries", description: kutsuFriesDescription, base_price: "350.00", availability_status: true, image_url: "/images/kutsu-pizza-fries.jpg", sizes: [{ id: "small", name: "Small", price: "350.00" }, { id: "large", name: "Large", price: "450.00" }], addons_config: [] },
  { item_id: "alfredo-pasta", category_id: "pasta", category_name: "Pasta", item_name: "Alfredo Pasta", description: "Creamy, rich pasta tossed in a smooth Alfredo sauce with aromatic herbs, juicy chicken, and a touch of seasoning, creating a deliciously comforting and indulgent meal.", base_price: "600.00", availability_status: true, image_url: "/images/alfredo-pasta.jpg", sizes: [], addons_config: [] },
  { item_id: "arbiata-pasta", category_id: "pasta", category_name: "Pasta", item_name: "Arbiata Pasta", description: "Al dente pasta tossed in a rich, spicy tomato sauce with garlic, herbs, flavourful chicken and cheese. Simple, bold, and delicious.", base_price: "550.00", availability_status: true, image_url: "/images/arbiata-pasta.jpg", sizes: [], addons_config: [] },
  { item_id: "tango-zinger-burger", category_id: "burgers", category_name: "Burgers", item_name: "Tango Zinger Burger", description: "Crispy, juicy zinger chicken fillet layered with creamy mayo, fresh lettuce, and our signature tangy sauce, served in a soft toasted bun. A deliciously crunchy and flavorful bite in every mouthful.", base_price: "500.00", availability_status: true, image_url: "/images/tango-zinger-burger.jpg", sizes: [], addons_config: [] },
  { item_id: "korean-noodles", category_id: "noodles", category_name: "Noodles", item_name: "Korean Noodles", description: "Spicy, flavorful Korean-style noodles tossed in a savory sauce and topped with a perfectly fried egg. A deliciously satisfying meal with a bold kick.", base_price: "350.00", availability_status: true, image_url: "/images/korean-noodles.jpg", sizes: [], addons_config: [] },
  { item_id: "nana-wings", category_id: "wings", category_name: "Wings", item_name: "Nana Wings", description: "Crispy, juicy chicken wings tossed in your choice of flavorful sauces, made fresh and served hot. Perfect for sharing or enjoying as a tasty snack.", base_price: "500.00", availability_status: true, image_url: "/images/nana-wings.jpg", sizes: [], addons_config: [] }
];
