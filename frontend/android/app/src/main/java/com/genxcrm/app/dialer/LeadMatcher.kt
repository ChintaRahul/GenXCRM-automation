package com.genxcrm.app.dialer

data class LeadRef(val leadId: String, val name: String)

interface LeadStore {
    fun read(): String?
    fun write(text: String)
}

// On-device number → lead lookup so an incoming call can be matched at ring time, offline.
// Persisted as tab-separated lines ("number\tleadId\tname") to avoid a JSON dependency in
// JVM unit tests; names are flattened so a tab/newline in a lead name cannot corrupt the file.
class LeadMatcher(private val store: LeadStore) {
    private var index: Map<String, LeadRef> = load()

    fun replaceAll(entries: List<Pair<String, LeadRef>>) {
        index = entries
            .map { (number, ref) -> PhoneNumbers.normalize(number) to ref.copy(name = flatten(ref.name)) }
            .filter { (number, _) -> number.isNotEmpty() }
            .toMap()
        store.write(index.entries.joinToString("\n") { (number, ref) -> "$number\t${ref.leadId}\t${ref.name}" })
    }

    fun match(number: String): LeadRef? = index[PhoneNumbers.normalize(number)]

    private fun load(): Map<String, LeadRef> =
        store.read().orEmpty().lines().mapNotNull { line ->
            val parts = line.split('\t', limit = 3)
            if (parts.size == 3) parts[0] to LeadRef(parts[1], parts[2]) else null
        }.toMap()

    private fun flatten(text: String) = text.replace(Regex("[\\t\\r\\n]+"), " ").trim()
}
