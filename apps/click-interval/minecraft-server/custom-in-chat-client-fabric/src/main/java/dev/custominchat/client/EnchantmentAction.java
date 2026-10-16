package dev.custominchat.client;

/** Fixed self-service commands: never accepts a player name or arbitrary command text. */
enum EnchantmentAction {
    MENU("menu", "enchants"),
    MINER("miner", "enchants toggle miner"),
    TREE("tree", "enchants toggle tree"),
    HARVESTER("harvester", "enchants toggle harvester");

    private final String key;
    private final String command;

    EnchantmentAction(String key, String command) { this.key = key; this.command = command; }
    String translationKey() { return "key.custom_in_chat_client." + key; }
    String command() { return command; }
}
